# Demo Enterprise level pipeline

Enterprise-grade Node.js service that reports **server time** and **hostname** through a JSON API and a live ops-monitor UI. Shipped with a full DevSecOps pipeline: secret scanning, SAST + quality gate, dependency audit, image scanning, DAST, ECR push, and GitOps delivery to an on-prem RKE2 cluster via ArgoCD.

---

## Table of Contents

- [Architecture](#architecture)
- [Endpoints](#endpoints)
- [Tech Stack](#tech-stack)
- [Local Development](#local-development)
- [Pipeline Stages](#pipeline-stages)
- [Required GitHub Secrets](#required-github-secrets)
- [One-Time Infrastructure Setup](#one-time-infrastructure-setup)
- [Scaling & Availability](#scaling--availability)
- [Security Controls](#security-controls)
- [Project Layout](#project-layout)
- [AWS OIDC Integration](#aws-oidc-integration)
- [License](#license)

---

## Architecture

```
Developer ──push──> GitHub ──Actions──┐
                                       │  gitleaks → test → audit → SonarQube (QG)
                                       │            → build → Trivy (image + IaC)
                                       │            → OWASP ZAP (DAST)
                                       │            → push to Amazon ECR
                                       │            → bump tag in k8s overlay (git)
                                       ▼
                              ArgoCD (on-prem) ──sync──> RKE2 cluster
                                                          ├─ Deployment (3+ pods, HPA → 12)
                                                          ├─ Service / Traefik IngressRoute (HTTPS)
                                                          └─ PDB / NetworkPolicy / non-root pods
```

The app is **stateless** — it scales horizontally with zero coordination. Each pod reports its own hostname/pod name, so the UI confirms which pod served the request (useful for verifying load-balancing).

---

## Endpoints

| Path        | Purpose                                              |
| ----------- | ---------------------------------------------------- |
| `/`         | Live monitor UI (polls `/api/info` every 2 s)        |
| `/api/info` | JSON: hostname, server time, uptime, pod/node info   |
| `/healthz`  | Liveness probe (always 200 if process is up)         |
| `/readyz`   | Readiness probe (503 until app is ready / draining)  |
| `/metrics`  | Prometheus metrics (`server_info_*`)                 |

```bash
curl -s http://localhost:8080/api/info | jq
```

---

## Tech Stack

| Layer       | Technology                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Runtime     | Node.js 20 (Express), `helmet`, `express-rate-limit`, `compression`, `pino`, `prom-client`     |
| Container   | Multi-stage Alpine, non-root (`uid 1000`), read-only rootfs, `tini` PID 1, `HEALTHCHECK`       |
| CI/CD       | GitHub Actions (OIDC to AWS — no static keys)                                                   |
| Security    | gitleaks · SonarQube + QG · `npm audit` · dependency-review · Trivy · OWASP ZAP · CodeQL       |
| Registry    | Amazon ECR (scan-on-push, immutable tags, lifecycle policy)                                     |
| Delivery    | Helm chart + ArgoCD (native Helm source, auto-sync, self-heal) → on-prem RKE2                  |
| Ingress     | Traefik `IngressRoute` (HTTPS, HSTS, security middleware)                                       |

---

## Local Development

### npm

```bash
npm install
npm run dev    # http://localhost:8080
npm test       # jest + coverage (thresholds enforced)
npm run lint
```

### Docker

```bash
docker build -t server-info:local .
docker compose up    # runs hardened: read-only, cap-drop ALL, no-new-privileges
```

---

## Pipeline Stages

Defined in `.github/workflows/ci-cd.yml`. Runs on every PR and on push to `main`. The deploy stage only runs on `main`.

| # | Job               | What it does                                           | Blocks on             |
| - | ----------------- | ------------------------------------------------------ | --------------------- |
| 1 | `secret-scan`     | gitleaks across full git history                       | any secret found      |
| 2 | `test`            | eslint + jest, uploads coverage                        | lint/test failure     |
| 3 | `dependencies`    | `npm audit` (high+) + dependency-review on PRs         | high CVE              |
| 4 | `sonarqube`       | SAST scan + Quality Gate wait                          | QG failure            |
| 5 | `build-scan-push` | build → Trivy (IaC + image) → ZAP DAST → push to ECR  | HIGH/CRIT vuln, DAST  |
| 6 | `deploy`          | bump image tag in overlay, commit → ArgoCD reconciles  | —                     |

> The image is **only pushed to ECR after every security gate passes**. Tags are immutable (`sha-<12char>`).

A scheduled deep scan (`.github/workflows/security-scan.yml`) runs weekly: Trivy filesystem/secret/misconfig scan + CodeQL, with results uploaded to the GitHub **Security** tab.

---

## Required GitHub Secrets

| Secret           | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `AWS_ROLE_ARN`   | IAM role ARN assumed via OIDC (ECR push permissions) |
| `ECR_REGISTRY`   | `<acct>.dkr.ecr.us-east-1.amazonaws.com`            |
| `SONAR_TOKEN`    | SonarQube authentication token                       |
| `SONAR_HOST_URL` | SonarQube server URL                                 |

> No long-lived AWS keys are stored — authentication uses GitHub OIDC federation.

---

## One-Time Infrastructure Setup

### AWS (ECR + OIDC Role)

```bash
export GH_ORG=<your-org> AWS_REGION=us-east-1
./scripts/aws-bootstrap.sh
# Then create the IAM role trusting your repo and set the AWS_ROLE_ARN secret
```

### ArgoCD (on-prem RKE2)

```bash
# Edit argocd/application.yaml: replace <ORG> and <AWS_ACCOUNT_ID>
./scripts/argocd-bootstrap.sh
argocd app get server-info
```

### Placeholders to Update Before First Deploy

| File                               | Placeholder                                       |
| ---------------------------------- | ------------------------------------------------- |
| `argocd/application.yaml`          | `<ORG>`, `<AWS_ACCOUNT_ID>`                       |
| `charts/server-info/values.yaml`   | `image.repository` (ECR URL with account ID)      |
| `charts/server-info/values.yaml`   | `ingressRoute.host`, `ingressRoute.tls.secretName`|

Render manifests locally to verify:

```bash
helm template server-info charts/server-info
```

---

## Scaling & Availability

| Feature              | Configuration                                                           |
| -------------------- | ----------------------------------------------------------------------- |
| HPA                  | 3 → 12 replicas on CPU 70% / memory 80%, with scale-up/down stabilization |
| PodDisruptionBudget  | `minAvailable: 2` — protects during node drains                         |
| Rolling updates      | `maxUnavailable: 0`, `maxSurge: 1` — zero-downtime deployments         |
| Topology spread      | Pods distributed across nodes                                           |
| Graceful shutdown    | SIGTERM flips readiness off, drains in-flight requests (10 s timeout)   |

---

## Security Controls

| Layer        | Control                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------- |
| App          | helmet (CSP, HSTS), rate limiting, JSON body cap, no `x-powered-by`, error masking             |
| Container    | Non-root, read-only rootfs, `cap_drop: ALL`, `no-new-privileges`, minimal Alpine               |
| Pod          | `runAsNonRoot`, `seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`         |
| Network      | NetworkPolicy: ingress only from Traefik + Prometheus; egress DNS only                         |
| Supply chain | gitleaks, npm audit, dependency-review, Trivy, immutable tags, ECR scan-on-push                |
| Pipeline     | OIDC (no static creds), least-privilege job permissions, quality gate, DAST                    |

---

## Project Layout

```
.
├── .github/
│   └── workflows/          # ci-cd.yml, security-scan.yml
├── src/
│   ├── app.js
│   ├── server.js
│   ├── routes/
│   ├── middleware/
│   └── public/             # Live ops-monitor UI.
├── test/                   # Jest suite.
├── charts/
│   └── server-info/        # Helm chart (templates/, values.yaml, Chart.yaml)
├── argocd/
│   └── application.yaml
├── scripts/
│   ├── aws-bootstrap.sh
│   └── argocd-bootstrap.sh
├── Dockerfile              # Multi-stage hardened build
├── docker-compose.yml      # Hardened local run
├── sonar-project.properties
├── .gitleaks.toml
├── .trivyignore
├── .zap/
│   └── rules.tsv
└── README.md
```

---

## AWS OIDC Integration

Follow these steps once to configure the IAM role that allows GitHub Actions to push images to ECR without storing long-lived credentials.

aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --region us-east-1


### Step 1 — Create the trust policy

```bash
cat > trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:bhuv01/nodejs-enterprise-app-helm:ref:refs/heads/main",
            "repo:bhuv01/nodejs-enterprise-app-helm:environment:prod"
          ]
        }
      }
    }
  ]
}
EOF
```

### Step 2 — Create the IAM role

```bash
aws iam create-role \
  --role-name github-actions-server-info-ecr \
  --assume-role-policy-document file://trust.json
```

### Step 3 — Create the ECR push policy

```bash
cat > ecr-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuth",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PushServerInfoImage",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:DescribeRepositories",
        "ecr:BatchGetImage"
      ],
      "Resource": "arn:aws:ecr:us-east-1:$AWS_ACCOUNT_ID:repository/server-info"
    }
  ]
}
EOF
```

### Step 4 — Attach the policy to the role

```bash
aws iam put-role-policy \
  --role-name github-actions-server-info-ecr \
  --policy-name ecr-push-server-info \
  --policy-document file://ecr-policy.json
```

After completing these steps, add the resulting role ARN as the `AWS_ROLE_ARN` GitHub secret.

---

## License

MIT
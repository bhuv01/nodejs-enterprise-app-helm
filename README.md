# server-info

Enterprise-grade Node.js service that reports **server time** and **hostname** through a JSON API and a live ops-monitor UI. Shipped with a full DevSecOps pipeline: secret scanning, SAST + quality gate, dependency audit, image scanning, DAST, ECR push, and GitOps delivery to an on-prem RKE2 cluster via ArgoCD.

---

## Architecture

```
Developer ──push──> GitHub ──Actions──┐
                                       │  gitleaks → test → audit → SonarQube(QG)
                                       │            → build → Trivy(image+IaC)
                                       │            → OWASP ZAP (DAST)
                                       │            → push to Amazon ECR
                                       │            → bump tag in k8s overlay (git)
                                       ▼
                              ArgoCD (on-prem) ──sync──> RKE2 cluster
                                                          └─ Deployment (3+ pods, HPA→12)
                                                          └─ Service / Traefik IngressRoute (HTTPS)
                                                          └─ PDB / NetworkPolicy / non-root pods
```

The app is **stateless** — it scales horizontally with zero coordination. Each pod reports its own hostname/pod name, so the UI confirms which pod served the request (useful for verifying load-balancing).

---

## Endpoints

| Path         | Purpose                                            |
| ------------ | -------------------------------------------------- |
| `/`          | Live monitor UI (polls `/api/info` every 2s)       |
| `/api/info`  | JSON: hostname, server time, uptime, pod/node info |
| `/healthz`   | Liveness probe (always 200 if process is up)       |
| `/readyz`    | Readiness probe (503 until app is ready / draining)|
| `/metrics`   | Prometheus metrics (`server_info_*`)               |

```bash
curl -s http://localhost:8080/api/info | jq
```

---

## Tech stack

- **Runtime:** Node.js 20 (Express), `helmet`, `express-rate-limit`, `compression`, `pino` structured logs, `prom-client` metrics
- **Container:** multi-stage Alpine, non-root (`uid 1000`), read-only rootfs, `tini` PID 1, `HEALTHCHECK`
- **CI/CD:** GitHub Actions (OIDC to AWS — no static keys)
- **Security gates:** gitleaks · SonarQube + Quality Gate · `npm audit` + dependency-review · Trivy (image + IaC) · OWASP ZAP (DAST) · CodeQL (scheduled)
- **Registry:** Amazon ECR (scan-on-push, immutable tags, lifecycle policy)
- **Delivery:** Helm chart + ArgoCD (native Helm source, auto-sync, self-heal) → on-prem RKE2
- **Ingress:** Traefik `IngressRoute` (HTTPS, HSTS, security middleware)

---

## Local development

```bash
npm install
npm run dev          # http://localhost:8080
npm test             # jest + coverage (thresholds enforced)
npm run lint
```

Docker:

```bash
docker build -t server-info:local .
docker compose up    # runs hardened: read-only, cap-drop ALL, no-new-privileges
```

---

## Pipeline stages (`.github/workflows/ci-cd.yml`)

Runs on every PR and on push to `main`. The deploy stage only runs on `main`.

| # | Job               | What it does                                              | Blocks on |
|---|-------------------|-----------------------------------------------------------|-----------|
| 1 | `secret-scan`     | gitleaks across full git history                          | any secret |
| 2 | `test`            | eslint + jest, uploads coverage                           | lint/test fail |
| 3 | `dependencies`    | `npm audit` (high+) + dependency-review on PRs            | high CVE |
| 4 | `sonarqube`       | SAST scan + **Quality Gate** wait                         | QG fail |
| 5 | `build-scan-push` | build → Trivy (IaC + image) → ZAP DAST → push ECR         | HIGH/CRIT vuln, DAST fail |
| 6 | `deploy`          | bump image tag in overlay, commit → ArgoCD reconciles     | — |

The image is **only pushed to ECR after every security gate passes**. Tags are immutable (`sha-<12char>`).

Scheduled deep scan (`.github/workflows/security-scan.yml`): weekly Trivy filesystem/secret/misconfig scan + CodeQL, results uploaded to the GitHub **Security** tab.

---

## Required GitHub secrets

| Secret            | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `AWS_ROLE_ARN`    | IAM role ARN assumed via OIDC (ECR push permissions)     |
| `ECR_REGISTRY`    | `<acct>.dkr.ecr.ap-south-1.amazonaws.com`                |
| `SONAR_TOKEN`     | SonarQube token                                          |
| `SONAR_HOST_URL`  | SonarQube server URL                                     |

No long-lived AWS keys are stored — auth uses GitHub OIDC federation.

---

## One-time infrastructure setup

**AWS (ECR + OIDC role):**

```bash
export GH_ORG=<your-org> AWS_REGION=ap-south-1
./scripts/aws-bootstrap.sh
# then create the IAM role trusting your repo and set AWS_ROLE_ARN secret
```

**ArgoCD (on-prem RKE2):**

```bash
# edit argocd/application.yaml: replace <ORG> and <AWS_ACCOUNT_ID>
./scripts/argocd-bootstrap.sh
argocd app get server-info
```

Update the placeholders before first deploy:

- `argocd/application.yaml` → `<ORG>`, `<AWS_ACCOUNT_ID>`
- `charts/server-info/values.yaml` → `image.repository` (`<AWS_ACCOUNT_ID>` ECR URL)
- `charts/server-info/values.yaml` → `ingressRoute.host` + `ingressRoute.tls.secretName`

Render manifests locally to verify:

```bash
helm template server-info charts/server-info
```

---

## Scaling & availability

- **HPA:** 3 → 12 replicas on CPU 70% / memory 80%, with scale-up/down stabilization
- **PodDisruptionBudget:** `minAvailable: 2` protects during node drains
- **Rolling updates:** `maxUnavailable: 0`, `maxSurge: 1` — zero-downtime
- **Topology spread:** pods distributed across nodes
- **Graceful shutdown:** SIGTERM flips readiness off, drains in-flight requests (10s timeout)

---

## Security controls

| Layer        | Control                                                              |
| ------------ | ------------------------------------------------------------------- |
| App          | helmet (CSP, HSTS), rate limiting, JSON body cap, no `x-powered-by`, error masking |
| Container    | non-root, read-only rootfs, `cap_drop: ALL`, `no-new-privileges`, distroless-style minimal Alpine |
| Pod          | `runAsNonRoot`, `seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false` |
| Network      | NetworkPolicy: ingress only from Traefik + Prometheus; egress DNS only |
| Supply chain | gitleaks, npm audit, dependency-review, Trivy, immutable tags, ECR scan-on-push |
| Pipeline     | OIDC (no static creds), least-privilege job permissions, quality gate, DAST |

---

## Project layout

```
.
├── .github/workflows/   ci-cd.yml, security-scan.yml
├── src/                 app.js, server.js, routes/, middleware/, public/ (UI)
├── test/                jest suite
├── charts/server-info/  Helm chart (templates/, values.yaml, Chart.yaml)
├── argocd/              application.yaml
├── scripts/             aws-bootstrap.sh, argocd-bootstrap.sh
├── Dockerfile           multi-stage hardened
├── docker-compose.yml   hardened local run
├── sonar-project.properties, .gitleaks.toml, .trivyignore, .zap/rules.tsv
└── README.md
```

---

## License

MIT

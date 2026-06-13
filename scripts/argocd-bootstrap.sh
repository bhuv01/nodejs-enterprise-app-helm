#!/usr/bin/env bash
# Register the app with ArgoCD on the on-prem RKE2 cluster.
set -euo pipefail

# ECR pull secret for the cluster (refresh via cronjob or ECR credential helper).
kubectl create namespace server-info --dry-run=client -o yaml | kubectl apply -f -

# Apply the ArgoCD Application (edit <ORG>/<AWS_ACCOUNT_ID> first).
kubectl apply -f argocd/application.yaml

echo "Watch sync:  argocd app get server-info"
echo "Manual sync: argocd app sync server-info"

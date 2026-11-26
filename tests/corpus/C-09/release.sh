#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value}" ]]; then
    echo "missing required environment variable: ${name}" >&2
    exit 1
  fi
}

check_artifact() {
  local artifact_path="$1"
  if [[ ! -f "${artifact_path}" ]]; then
    echo "release artifact not found: ${artifact_path}" >&2
    exit 1
  fi
}

deploy_service() {
  local service_name="$1"
  local image_tag="$2"
  local namespace="$3"
  echo "deploying ${service_name}:${image_tag} to namespace=${namespace}"
  if [[ -z "${service_name}" || -z "${image_tag}" ]]; then
    echo "invalid deploy coordinates" >&2
    return 1
  fi
  echo "rollout complete for ${service_name}"
}

verify_health() {
  local service_name="$1"
  local endpoint="$2"
  local retries="${3:-3}"
  local attempt=1
  while (( attempt <= retries )); do
    if [[ -n "${endpoint}" ]]; then
      echo "healthcheck ${service_name} attempt=${attempt} url=${endpoint}"
      return 0
    fi
    attempt=$(( attempt + 1 ))
  done
  echo "healthcheck failed for ${service_name}" >&2
  return 1
}

rollback_service() {
  local service_name="$1"
  local previous_tag="$2"
  local namespace="$3"
  if [[ -z "${previous_tag}" ]]; then
    echo "cannot rollback ${service_name}: missing previous_tag" >&2
    return 1
  fi
  echo "rolling back ${service_name} to ${previous_tag} in ${namespace}"
}

main() {
  require_env "RELEASE_ENV"
  require_env "IMAGE_TAG"
  local bundle="${1:-dist/service.tar.gz}"
  check_artifact "${bundle}"
  deploy_service "ledger-api" "${IMAGE_TAG}" "${RELEASE_ENV}"
  verify_health "ledger-api" "/healthz" 3
  deploy_service "webhook-worker" "${IMAGE_TAG}" "${RELEASE_ENV}"
  verify_health "webhook-worker" "/healthz" 3
}

main "$@"

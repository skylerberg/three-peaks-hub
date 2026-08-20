# GCLB health checks reach standalone-NEG endpoints at the pod's serving port,
# which the cluster's own rules only open for 80 and 443. A separate rule from
# critical-path's, deliberately: a `terraform destroy` of that stack must not
# silently break health checks here.
resource "google_compute_firewall" "health_checks" {
  name      = "${local.name}-lb-health-checks"
  network   = "default"
  direction = "INGRESS"

  source_ranges = [
    "130.211.0.0/22",
    "35.191.0.0/16",
  ]
  target_tags = [local.gke_node_tag]

  allow {
    protocol = "tcp"
    ports    = [tostring(local.api_port)]
  }
}

resource "google_compute_health_check" "api" {
  name = "${local.name}-api-health-check"

  timeout_sec         = 5
  check_interval_sec  = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    request_path       = "/health"
    port_specification = "USE_SERVING_PORT"
  }
}

# GKE creates this NEG from the Service's cloud.google.com/neg annotation, so on
# a fresh environment the first deploy has to run before this data source can
# resolve. See README.md for the apply ordering.
data "google_compute_network_endpoint_group" "api" {
  name = "${local.name}-api-neg"
  zone = local.zone
}

resource "google_compute_backend_service" "api" {
  name                  = "${local.name}-api-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # Long, because /ws is a WebSocket and the LB treats the whole connection as
  # one request.
  timeout_sec                     = 3600
  session_affinity                = "NONE"
  connection_draining_timeout_sec = 60

  backend {
    group                 = data.google_compute_network_endpoint_group.api.self_link
    balancing_mode        = "RATE"
    max_rate_per_endpoint = 100
  }

  health_checks = [google_compute_health_check.api.self_link]

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

# Workload Identity: the pod's Kubernetes service account impersonates this one,
# which is how it reaches the uploads bucket with no key file anywhere.
resource "google_service_account" "api" {
  account_id   = "${local.name}-api"
  display_name = "Three Peaks Hub API (GKE Workload Identity)"
}

resource "google_service_account_iam_member" "api_workload_identity" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${local.project}.svc.id.goog[${local.name}/${local.name}-api]"
}

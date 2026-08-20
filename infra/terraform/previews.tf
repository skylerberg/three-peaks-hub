# Per-PR previews. A small Cloud Run service serves each PR's build out of a
# pr/<n>/ prefix in the web bucket, with SPA fallback to that PR's index.html.
# The wildcard host routes everything except the API paths here, so a preview is
# a full same-origin virtual host.

resource "google_service_account" "preview_edge" {
  account_id   = "${local.name}-preview-edge"
  display_name = "Three Peaks Hub preview edge (Cloud Run)"
}

# Read-only, and only on the web bucket. The edge never touches uploads.
resource "google_storage_bucket_iam_member" "web_preview_edge" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.preview_edge.email}"
}

resource "google_cloud_run_v2_service" "preview_edge" {
  name     = "${local.name}-preview-edge"
  location = local.region

  # Only the global load balancer may reach it. The public run.app URL is
  # blocked, so nothing bypasses the routing above.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  deletion_protection = false

  template {
    service_account = google_service_account.preview_edge.email

    containers {
      image = "${local.region}-docker.pkg.dev/${local.project}/${local.name}/preview-edge:latest"

      env {
        name  = "WEB_BUCKET"
        value = google_storage_bucket.web.name
      }
      env {
        name  = "PREVIEW_HOST_SUFFIX"
        value = local.preview_host_suffix
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  # Terraform bootstraps the service; the preview-edge workflow pushes the image
  # and rolls it out. Ignored here so applies and deploys do not fight over it.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_compute_region_network_endpoint_group" "preview_edge" {
  name                  = "${local.name}-preview-edge-neg"
  region                = local.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.preview_edge.name
  }
}

# No CDN: previews are low-traffic, and a force-push to the same pr/<n>/ prefix
# has to be picked up immediately.
resource "google_compute_backend_service" "preview_edge" {
  name                            = "${local.name}-preview-edge-backend"
  load_balancing_scheme           = "EXTERNAL_MANAGED"
  connection_draining_timeout_sec = 30

  backend {
    group = google_compute_region_network_endpoint_group.preview_edge.self_link
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

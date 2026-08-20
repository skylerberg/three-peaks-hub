# Private. Who may read a project's files depends on membership, so the bytes
# are served through the API rather than from a public object.
resource "google_storage_bucket" "uploads" {
  name                        = "${local.name}-uploads-prod"
  location                    = "US"
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "uploads_api" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

# Public, and only ever holds the built SPA.
resource "google_storage_bucket" "web" {
  name                        = "${local.name}-web-prod"
  location                    = "US"
  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
}

resource "google_storage_bucket_iam_member" "web_public" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_iam_member" "web_deployer" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:github-actions-service@${local.project}.iam.gserviceaccount.com"
}

resource "google_compute_backend_bucket" "web" {
  name             = "${local.name}-web-backend"
  bucket_name      = google_storage_bucket.web.name
  enable_cdn       = true
  compression_mode = "AUTOMATIC"

  # Without this the CDN defaults to CACHE_ALL_STATIC, whose client_ttl caps the
  # browser-facing max-age at 3600 -- defeating the immutable year-long headers
  # the deploy sets on content-hashed assets.
  cdn_policy {
    cache_mode = "USE_ORIGIN_HEADERS"
  }
}

resource "google_artifact_registry_repository" "main" {
  location      = local.region
  repository_id = local.name
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }
}

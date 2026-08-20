output "lb_ip" {
  description = "Point the Route 53 A record for tools.threepeaksgames.com here"
  value       = google_compute_global_address.main.address
}

output "wildcard_cert_dns_validation" {
  description = "Publish this CNAME in Route 53 to validate the wildcard certificate"
  value = {
    name = google_certificate_manager_dns_authorization.preview.dns_resource_record[0].name
    type = google_certificate_manager_dns_authorization.preview.dns_resource_record[0].type
    data = google_certificate_manager_dns_authorization.preview.dns_resource_record[0].data
  }
}

output "uploads_bucket" {
  value = google_storage_bucket.uploads.name
}

output "web_bucket" {
  value = google_storage_bucket.web.name
}

output "image_repository" {
  value = "${local.region}-docker.pkg.dev/${local.project}/${google_artifact_registry_repository.main.repository_id}"
}

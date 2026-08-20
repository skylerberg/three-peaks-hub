resource "google_monitoring_notification_channel" "email" {
  display_name = "Skyler (email)"
  type         = "email"

  labels = {
    email_address = "skylertheberg@gmail.com"
  }
}

resource "google_monitoring_uptime_check_config" "health" {
  display_name = "${local.name} /health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.project
      host       = local.domain
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  display_name = "${local.name} /health failing"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failures"

    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.health.uptime_check_id}\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "60s"

      trigger {
        count = 1
      }

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "lb_5xx" {
  display_name = "${local.name} LB 5xx responses"
  combiner     = "OR"

  conditions {
    display_name = "Sustained 5xx from the load balancer"

    condition_threshold {
      filter          = "metric.type=\"loadbalancing.googleapis.com/https/request_count\" AND resource.type=\"https_lb_rule\" AND resource.label.url_map_name=\"${google_compute_url_map.main.name}\" AND metric.label.response_code_class=\"500\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.03
      duration        = "300s"

      trigger {
        count = 1
      }

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

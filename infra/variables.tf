variable "project" {
  description = "Short resource prefix; must be unique in your account."
  type        = string
  default     = "navalnyvpn"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.project))
    error_message = "Use 3–25 lowercase letters, numbers, or hyphens."
  }
}
variable "domain" {
  description = "Future portal domain. No domain registration or DNS changes are performed."
  type        = string
  default     = "navalnyvpn.net"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.domain))
    error_message = "Supply a DNS hostname without a scheme or path."
  }
}
variable "enabled_regions" {
  description = "Supported gateways. us-east-1 is required for the control host subnet."
  type        = set(string)
  default     = ["us-east-1", "eu-central-1", "ap-southeast-1"]
  validation {
    condition     = contains(var.enabled_regions, "us-east-1") && length(setsubtract(var.enabled_regions, toset(["us-east-1", "eu-central-1", "ap-southeast-1"]))) == 0
    error_message = "Use supported regions and include us-east-1."
  }
}
variable "gateway_instance_type" {
  type        = string
  default     = "t3.small"
  description = "x86_64 gateway instance. Burstable instances use standard credit mode."
  validation {
    condition     = startswith(var.gateway_instance_type, "t3.")
    error_message = "This baseline supports t3 x86_64 instances; change AMI and credit configuration to use another family."
  }
}
variable "control_instance_type" {
  type        = string
  default     = "t3.small"
  description = "x86_64 portal/API instance."
  validation {
    condition     = startswith(var.control_instance_type, "t3.")
    error_message = "This baseline supports t3 x86_64 instances."
  }
}
variable "app_image_tag" {
  description = "Immutable ECR image tag built and pushed by the operator."
  type        = string
  default     = "v1"
  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", var.app_image_tag))
    error_message = "Use a valid immutable container image tag."
  }
}
variable "portal_service_enabled" {
  description = "Enable after creating the ECR repository and pushing app_image_tag."
  type        = bool
  default     = false
}
variable "portal_min_tasks" {
  description = "Minimum portal Fargate task count; at least two tasks are required for redundancy."
  type        = number
  default     = 2
  validation {
    condition     = var.portal_min_tasks >= 2 && var.portal_min_tasks <= 20
    error_message = "portal_min_tasks must be between 2 and 20."
  }
}
variable "portal_max_tasks" {
  description = "Maximum portal Fargate task count for target-tracking autoscaling."
  type        = number
  default     = 8
  validation {
    condition     = var.portal_max_tasks >= var.portal_min_tasks && var.portal_max_tasks <= 100
    error_message = "portal_max_tasks must be at least portal_min_tasks and no more than 100."
  }
}
variable "portal_cpu_target" {
  type        = number
  default     = 55
  description = "Target average ECS service CPU utilization percentage."
  validation {
    condition     = var.portal_cpu_target >= 20 && var.portal_cpu_target <= 90
    error_message = "Set a CPU target from 20 through 90 percent."
  }
}
variable "portal_memory_target" {
  type        = number
  default     = 70
  description = "Target average ECS service memory utilization percentage."
  validation {
    condition     = var.portal_memory_target >= 20 && var.portal_memory_target <= 90
    error_message = "Set a memory target from 20 through 90 percent."
  }
}
variable "pihole_image" {
  type        = string
  default     = "pihole/pihole:2026.09.0"
  description = "Reviewed Pi-hole v6 image tag. Pin a digest for immutable production releases."
}
variable "vpn_ingress_cidrs" {
  type        = set(string)
  default     = ["0.0.0.0/0"]
  description = "Clients allowed to connect to OpenVPN UDP/1194 and TCP/443 fallback."
  validation {
    condition     = length(var.vpn_ingress_cidrs) > 0 && alltrue([for c in var.vpn_ingress_cidrs : can(cidrnetmask(c))])
    error_message = "Supply at least one valid IPv4 CIDR."
  }
}

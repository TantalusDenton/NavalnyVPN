terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 6.0" } }
}
variable "project" { type = string }
variable "region" { type = string }
variable "cidr" { type = string }
variable "instance_type" { type = string }
variable "bucket_arn" { type = string }
variable "bucket_name" { type = string }
variable "artifact_region" { type = string }
variable "pihole_image" { type = string }
variable "ingress_cidrs" { type = set(string) }

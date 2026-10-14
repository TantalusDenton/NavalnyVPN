module "virginia" {
  source          = "./modules/gateway"
  project         = var.project
  region          = "us-east-1"
  cidr            = "10.40.0.0/16"
  instance_type   = var.gateway_instance_type
  bucket_arn      = aws_s3_bucket.artifacts.arn
  bucket_name     = aws_s3_bucket.artifacts.id
  artifact_region = "us-east-1"
  pihole_image    = var.pihole_image
  ingress_cidrs   = var.vpn_ingress_cidrs
}
module "frankfurt" {
  count           = contains(var.enabled_regions, "eu-central-1") ? 1 : 0
  source          = "./modules/gateway"
  providers       = { aws = aws.europe }
  project         = var.project
  region          = "eu-central-1"
  cidr            = "10.41.0.0/16"
  instance_type   = var.gateway_instance_type
  bucket_arn      = aws_s3_bucket.artifacts.arn
  bucket_name     = aws_s3_bucket.artifacts.id
  artifact_region = "us-east-1"
  pihole_image    = var.pihole_image
  ingress_cidrs   = var.vpn_ingress_cidrs
}
module "singapore" {
  count           = contains(var.enabled_regions, "ap-southeast-1") ? 1 : 0
  source          = "./modules/gateway"
  providers       = { aws = aws.asia }
  project         = var.project
  region          = "ap-southeast-1"
  cidr            = "10.42.0.0/16"
  instance_type   = var.gateway_instance_type
  bucket_arn      = aws_s3_bucket.artifacts.arn
  bucket_name     = aws_s3_bucket.artifacts.id
  artifact_region = "us-east-1"
  pihole_image    = var.pihole_image
  ingress_cidrs   = var.vpn_ingress_cidrs
}
locals {
  gateways = concat(
    [merge(module.virginia.gateway, { name = "Virginia", country = "United States", code = "US", continent = "North America" })],
    [for m in module.frankfurt : merge(m.gateway, { name = "Frankfurt", country = "Germany", code = "DE", continent = "Europe" })],
    [for m in module.singapore : merge(m.gateway, { name = "Singapore", country = "Singapore", code = "SG", continent = "Asia Pacific" })]
  )
}

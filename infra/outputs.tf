output "portal_url" { value = "https://${var.domain}" }
output "portal_public_ip" { value = aws_eip.control.public_ip }
output "control_instance_id" { value = aws_instance.control.id }
output "portal_image_repository" { value = aws_ecr_repository.portal.repository_url }
output "portal_database_table" { value = aws_dynamodb_table.portal.name }
output "portal_load_balancer" { value = aws_lb.portal.dns_name }
output "portal_fargate_service" {
  value = var.portal_service_enabled ? aws_ecs_service.portal[0].name : null
}
output "gateways" { value = local.gateways }
output "artifact_bucket" { value = aws_s3_bucket.artifacts.id }
output "cognito_user_pool_id" { value = aws_cognito_user_pool.users.id }
output "future_dns_record" {
  description = "Informational only. Terraform does not create this record or register any domain."
  value       = { type = "A", name = var.domain, value = aws_eip.control.public_ip }
}
output "data_volume_ids" {
  value = concat([aws_ebs_volume.control_data.id], [for g in local.gateways : g.dataVolumeId])
}

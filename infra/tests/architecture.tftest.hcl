mock_provider "aws" {
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a"] }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
}
mock_provider "aws" {
  alias = "europe"
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_availability_zones" { defaults = { names = ["eu-central-1a"] } }
  mock_data "aws_ssm_parameter" { defaults = { value = "ami-0123456789abcdef0" } }
}
mock_provider "aws" {
  alias = "asia"
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_availability_zones" { defaults = { names = ["ap-southeast-1a"] } }
  mock_data "aws_ssm_parameter" { defaults = { value = "ami-0123456789abcdef0" } }
}
run "three_region_plan" {
  command = plan
  assert {
    condition     = length(output.gateways) == 3
    error_message = "The default deployment must configure three regional gateways."
  }
  assert {
    condition     = output.future_dns_record.name == "navalnyvpn.net"
    error_message = "The future domain must be navalnyvpn.net."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.generate_secret == false && aws_cognito_user_pool_client.web.enable_token_revocation
    error_message = "Authentication must use a public, revocable Cognito client."
  }
  assert {
    condition     = aws_ebs_volume.control_data.encrypted && aws_instance.control.metadata_options[0].http_tokens == "required"
    error_message = "Account storage and instance metadata require secure defaults."
  }
  assert {
    condition     = alltrue([for rule in aws_security_group.control.ingress : contains([80, 443], rule.from_port)])
    error_message = "Only HTTP validation and HTTPS may be public on the portal."
  }
}
run "single_region_plan" {
  command = plan
  variables { enabled_regions = ["us-east-1"] }
  assert {
    condition     = length(output.gateways) == 1
    error_message = "Operators must be able to deploy just one region."
  }
}

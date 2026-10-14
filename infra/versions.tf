terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags { tags = { Project = var.project, ManagedBy = "Terraform" } }
}
provider "aws" {
  alias  = "europe"
  region = "eu-central-1"
  default_tags { tags = { Project = var.project, ManagedBy = "Terraform" } }
}
provider "aws" {
  alias  = "asia"
  region = "ap-southeast-1"
  default_tags { tags = { Project = var.project, ManagedBy = "Terraform" } }
}

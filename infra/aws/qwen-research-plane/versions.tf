terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "amos-managed-platform-terraform-state-637423327454"
    key            = "research/qwen-research-plane/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "amos-managed-platform-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "amos-qwen-research-plane"
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "amos-agent"
    }
  }
}

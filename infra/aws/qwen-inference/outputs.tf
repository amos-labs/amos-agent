output "aws_region" {
  value = var.aws_region
}

output "availability_zone" {
  value = var.availability_zone
}

output "model_bucket" {
  value = aws_s3_bucket.models.id
}

output "model_key_prefix" {
  value = local.model_key_prefix
}

output "vllm_repository_url" {
  value = aws_ecr_repository.vllm.repository_url
}

output "api_key_secret_id" {
  value = aws_secretsmanager_secret.api_key.id
}

output "instance_id" {
  value = try(aws_instance.inference[0].id, null)
}

output "served_model_name" {
  value = var.served_model_name
}

output "ssm_tunnel_command" {
  value = var.inference_enabled ? "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.inference[0].id} --document-name AWS-StartPortForwardingSession --parameters portNumber=8000,localPortNumber=18080" : null
}

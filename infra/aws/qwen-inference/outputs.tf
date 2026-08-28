output "aws_region" {
  value = var.aws_region
}

output "availability_zone" {
  value = var.availability_zone
}

output "vpc_id" {
  value = aws_vpc.inference.id
}

output "private_subnet_id" {
  value = aws_subnet.private.id
}

output "inference_security_group_id" {
  value = aws_security_group.inference.id
}

output "kms_key_arn" {
  value = aws_kms_key.inference.arn
}

output "model_bucket" {
  value = aws_s3_bucket.models.id
}

output "model_bucket_arn" {
  value = aws_s3_bucket.models.arn
}

output "model_key_prefix" {
  value = local.model_key_prefix
}

output "vllm_repository_url" {
  value = aws_ecr_repository.vllm.repository_url
}

output "swarm_gateway_repository_url" {
  value = aws_ecr_repository.swarm_gateway.repository_url
}

output "api_key_secret_id" {
  value = aws_secretsmanager_secret.api_key.id
}

output "api_key_secret_arn" {
  value = aws_secretsmanager_secret.api_key.arn
}

output "instance_id" {
  value = try(aws_instance.inference[0].id, null)
}

output "instance_private_ip" {
  value = try(aws_instance.inference[0].private_ip, null)
}

output "served_model_name" {
  value = var.served_model_name
}

output "ssm_tunnel_command" {
  value = var.inference_enabled ? "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.inference[0].id} --document-name AWS-StartPortForwardingSession --parameters portNumber=8000,localPortNumber=18080" : null
}

output "platform_peering_connection_id" {
  value = try(aws_vpc_peering_connection.platform[0].id, null)
}

output "hosted_qwen_base_url" {
  value = var.inference_enabled ? "http://${aws_instance.inference[0].private_ip}:8000/v1" : null
}

output "swarm_gateway_private_base_url" {
  value = var.inference_enabled ? "http://${aws_instance.inference[0].private_ip}:${var.swarm_gateway_port}/v1" : null
}

output "swarm_gateway_association_id" {
  value = try(aws_ssm_association.swarm_gateway[0].association_id, null)
}

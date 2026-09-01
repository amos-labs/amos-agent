output "artifact_bucket" {
  value = aws_s3_bucket.research.id
}

output "job_queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "dead_letter_queue_url" {
  value = aws_sqs_queue.dead_letter.url
}

output "run_table" {
  value = aws_dynamodb_table.runs.name
}

output "runner_repository_url" {
  value = aws_ecr_repository.runner.repository_url
}

output "trainer_repository_url" {
  value = aws_ecr_repository.trainer.repository_url
}

output "runner_instance_id" {
  value = try(aws_instance.runner[0].id, null)
}

output "qwen_private_api_base" {
  value = "http://${data.aws_instance.inference.private_ip}:8000/v1"
}

output "trainer_instance_id" {
  value = try(aws_instance.trainer[0].id, null)
}

output "trainer_contract_uri" {
  value = var.trainer_contract_uri
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "inference" {
  filter {
    name   = "tag:Name"
    values = [var.inference_name]
  }
}

data "aws_security_group" "inference" {
  name   = "${var.inference_name}-instance"
  vpc_id = data.aws_vpc.inference.id
}

data "aws_security_group" "inference_endpoints" {
  name   = "${var.inference_name}-endpoints"
  vpc_id = data.aws_vpc.inference.id
}

data "aws_kms_alias" "inference" {
  name = "alias/${var.inference_name}"
}

data "aws_secretsmanager_secret" "inference_api_key" {
  name = "${var.inference_name}/vllm-api-key"
}

data "aws_instances" "inference" {
  filter {
    name   = "tag:Name"
    values = [var.inference_name]
  }

  filter {
    name   = "instance-state-name"
    values = ["pending", "running", "stopping", "stopped"]
  }
}

data "aws_instance" "inference" {
  instance_id = one(data.aws_instances.inference.ids)
}

locals {
  name         = "amos-qwen-${var.environment}-plane"
  model_bucket = "${var.inference_name}-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
}

resource "terraform_data" "validated_inputs" {
  input = {
    runner_enabled  = var.runner_enabled
    trainer_enabled = var.trainer_enabled
  }

  lifecycle {
    precondition {
      condition     = !var.runner_enabled || var.runner_image_uri != ""
      error_message = "runner_image_uri must be pinned before runner_enabled is true."
    }
    precondition {
      condition = !var.trainer_enabled || (
        var.trainer_ami_id != "" &&
        var.trainer_image_uri != "" &&
        var.trainer_contract_uri != ""
      )
      error_message = "trainer_ami_id, trainer_image_uri, and trainer_contract_uri must be pinned before trainer_enabled is true."
    }
  }
}

resource "aws_s3_bucket" "research" {
  bucket        = "${local.name}-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "research" {
  bucket = aws_s3_bucket.research.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "research" {
  bucket = aws_s3_bucket.research.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = data.aws_kms_alias.inference.target_key_arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "research" {
  bucket                  = aws_s3_bucket.research.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "research" {
  bucket = aws_s3_bucket.research.id

  rule {
    id     = "expire-transient-job-staging"
    status = "Enabled"

    filter { prefix = "staging/" }

    expiration { days = 14 }
    noncurrent_version_expiration { noncurrent_days = 7 }
  }
}

resource "aws_sqs_queue" "dead_letter" {
  name                      = "${local.name}-dead-letter"
  message_retention_seconds = 1209600
  kms_master_key_id         = data.aws_kms_alias.inference.target_key_arn
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${local.name}-jobs"
  visibility_timeout_seconds = 43200
  message_retention_seconds  = 1209600
  receive_wait_time_seconds  = 20
  kms_master_key_id          = data.aws_kms_alias.inference.target_key_arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = var.max_job_receive_count
  })
}

resource "aws_dynamodb_table" "runs" {
  name         = "${local.name}-runs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "run_id"

  attribute {
    name = "run_id"
    type = "S"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_alias.inference.target_key_arn
  }
}

resource "aws_ecr_repository" "runner" {
  name                 = "${local.name}/runner"
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = data.aws_kms_alias.inference.target_key_arn
  }

  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "trainer" {
  name                 = "${local.name}/trainer"
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = data.aws_kms_alias.inference.target_key_arn
  }

  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each = {
    runner  = aws_ecr_repository.runner.name
    trainer = aws_ecr_repository.trainer.name
  }

  repository = each.value
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest twenty immutable research images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "runner" {
  name              = "/amos/qwen/${var.environment}/research-runner"
  retention_in_days = 30
}

resource "aws_internet_gateway" "runner" {
  vpc_id = data.aws_vpc.inference.id
  tags   = { Name = "${local.name}-runner" }
}

resource "aws_subnet" "runner" {
  vpc_id                  = data.aws_vpc.inference.id
  availability_zone       = var.availability_zone
  cidr_block              = "10.86.0.64/26"
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-runner" }
}

resource "aws_route_table" "runner" {
  vpc_id = data.aws_vpc.inference.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.runner.id
  }

  tags = { Name = "${local.name}-runner" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route_table_association" "runner" {
  route_table_id = aws_route_table.runner.id
  subnet_id      = aws_subnet.runner.id
}

resource "aws_security_group" "runner" {
  name        = "${local.name}-runner"
  description = "No inbound traffic; outbound research and private Qwen access only"
  vpc_id      = data.aws_vpc.inference.id

  egress {
    description = "HTTPS for task images and AWS APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP to the resolved Debian benchmark package mirror"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["140.248.150.132/32"]
  }

  egress {
    description = "VPC DNS over UDP"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = [data.aws_vpc.inference.cidr_block]
  }

  egress {
    description = "VPC DNS over TCP"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.inference.cidr_block]
  }

  egress {
    description     = "Private vLLM endpoint"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [data.aws_security_group.inference.id]
  }
}

resource "aws_vpc_security_group_ingress_rule" "qwen_from_runner" {
  security_group_id            = data.aws_security_group.inference.id
  referenced_security_group_id = aws_security_group.runner.id
  description                  = "Authenticated vLLM traffic from the no-ingress research runner"
  from_port                    = 8000
  to_port                      = 8000
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "aws_endpoints_from_runner" {
  security_group_id            = data.aws_security_group.inference_endpoints.id
  referenced_security_group_id = aws_security_group.runner.id
  description                  = "Private AWS API traffic from the no-ingress research runner"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}

resource "aws_iam_role" "runner" {
  name = "${local.name}-runner"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "runner_ssm" {
  role       = aws_iam_role.runner.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "runner" {
  name = "${local.name}-runner"
  role = aws_iam_role.runner.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "JobQueue"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"]
        Resource = [aws_sqs_queue.jobs.arn]
      },
      {
        Sid      = "RunLedger"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = [aws_dynamodb_table.runs.arn]
      },
      {
        Sid      = "ResearchArtifacts"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.research.arn]
      },
      {
        Sid      = "ResearchArtifactObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.research.arn}/*"]
      },
      {
        Sid      = "InferenceCredential"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [data.aws_secretsmanager_secret.inference_api_key.arn]
      },
      {
        Sid      = "ResearchKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
        Resource = [data.aws_kms_alias.inference.target_key_arn]
      },
      {
        Sid      = "EcrAuthorization"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "PullRunner"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = [aws_ecr_repository.runner.arn]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "runner" {
  name = "${local.name}-runner"
  role = aws_iam_role.runner.name
}

resource "aws_instance" "runner" {
  count = var.runner_enabled ? 1 : 0

  lifecycle {
    create_before_destroy = true
  }

  ami                         = var.runner_ami_id
  instance_type               = var.runner_instance_type
  availability_zone           = var.availability_zone
  subnet_id                   = aws_subnet.runner.id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.runner.id]
  iam_instance_profile        = aws_iam_instance_profile.runner.name
  monitoring                  = true
  ebs_optimized               = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.runner_root_volume_gib
    encrypted             = true
    kms_key_id            = data.aws_kms_alias.inference.target_key_arn
    delete_on_termination = true
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/runner-user-data.sh.tftpl", {
    api_base          = "http://${data.aws_instance.inference.private_ip}:8000/v1"
    api_key_secret_id = data.aws_secretsmanager_secret.inference_api_key.id
    artifact_bucket   = aws_s3_bucket.research.id
    aws_region        = var.aws_region
    ecr_registry      = split("/", aws_ecr_repository.runner.repository_url)[0]
    job_queue_url     = aws_sqs_queue.jobs.url
    run_table         = aws_dynamodb_table.runs.name
    runner_image_uri  = var.runner_image_uri
    served_model_name = var.served_model_name
  })

  depends_on = [
    aws_iam_role_policy.runner,
    aws_iam_role_policy_attachment.runner_ssm,
    aws_route_table_association.runner,
    aws_s3_bucket_server_side_encryption_configuration.research,
    aws_s3_bucket_public_access_block.research
  ]

  tags = { Name = "${local.name}-runner" }
}

resource "aws_cloudwatch_metric_alarm" "runner_status" {
  count = var.runner_enabled ? 1 : 0

  alarm_name          = "${local.name}-runner-status"
  alarm_description   = "The AMOS research runner failed an EC2 status check"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  dimensions          = { InstanceId = aws_instance.runner[0].id }
}

resource "aws_security_group" "trainer" {
  name        = "${local.name}-trainer"
  description = "No inbound traffic; disposable Qwen trainer HTTPS egress only"
  vpc_id      = data.aws_vpc.inference.id

  egress {
    description = "HTTPS for AWS APIs, ECR, and the pinned Hugging Face checkpoint"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "VPC DNS over UDP"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = [data.aws_vpc.inference.cidr_block]
  }

  egress {
    description = "VPC DNS over TCP"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.inference.cidr_block]
  }
}

resource "aws_vpc_security_group_ingress_rule" "aws_endpoints_from_trainer" {
  security_group_id            = data.aws_security_group.inference_endpoints.id
  referenced_security_group_id = aws_security_group.trainer.id
  description                  = "Private AWS API traffic from the no-ingress disposable trainer"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}

resource "aws_iam_role" "trainer" {
  name = "${local.name}-trainer"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "trainer_ssm" {
  role       = aws_iam_role.trainer.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "trainer" {
  name = "${local.name}-trainer"
  role = aws_iam_role.trainer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ResearchArtifacts"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.research.arn]
      },
      {
        Sid      = "ResearchArtifactObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.research.arn}/*"]
      },
      {
        Sid      = "ResearchKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
        Resource = [data.aws_kms_alias.inference.target_key_arn]
      },
      {
        Sid      = "EcrAuthorization"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "PullTrainer"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = [aws_ecr_repository.trainer.arn]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "trainer" {
  name = "${local.name}-trainer"
  role = aws_iam_role.trainer.name
}

resource "aws_instance" "trainer" {
  count = var.trainer_enabled ? 1 : 0

  ami                         = var.trainer_ami_id
  instance_type               = var.trainer_instance_type
  availability_zone           = var.availability_zone
  subnet_id                   = aws_subnet.runner.id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.trainer.id]
  iam_instance_profile        = aws_iam_instance_profile.trainer.name
  monitoring                  = true
  ebs_optimized               = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.trainer_root_volume_gib
    encrypted             = true
    kms_key_id            = data.aws_kms_alias.inference.target_key_arn
    delete_on_termination = true
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/trainer-user-data.sh.tftpl", {
    aws_region           = var.aws_region
    ecr_registry         = split("/", aws_ecr_repository.trainer.repository_url)[0]
    trainer_contract_uri = var.trainer_contract_uri
    trainer_image_uri    = var.trainer_image_uri
  })

  depends_on = [
    aws_iam_role_policy.trainer,
    aws_iam_role_policy_attachment.trainer_ssm,
    aws_route_table_association.runner,
    aws_s3_bucket_server_side_encryption_configuration.research,
    aws_s3_bucket_public_access_block.research
  ]

  tags = {
    Name    = "${local.name}-trainer"
    Purpose = "stage-zero-qlora-lineage-proof"
  }
}

resource "aws_cloudwatch_metric_alarm" "trainer_status" {
  count = var.trainer_enabled ? 1 : 0

  alarm_name          = "${local.name}-trainer-status"
  alarm_description   = "The disposable AMOS Qwen trainer failed an EC2 status check"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  dimensions          = { InstanceId = aws_instance.trainer[0].id }
}

data "aws_caller_identity" "current" {}

resource "terraform_data" "validated_inputs" {
  input = var.inference_enabled

  lifecycle {
    precondition {
      condition     = !var.inference_enabled || var.ami_id != ""
      error_message = "ami_id must be pinned before inference_enabled is true."
    }
    precondition {
      condition     = !var.inference_enabled || var.vllm_image_uri != ""
      error_message = "vllm_image_uri must be pinned before inference_enabled is true."
    }
    precondition {
      condition     = !var.inference_enabled || var.model_manifest_sha256 != ""
      error_message = "model_manifest_sha256 must be pinned before inference_enabled is true."
    }
    precondition {
      condition     = !var.swarm_gateway_enabled || var.inference_enabled
      error_message = "inference_enabled must be true before swarm_gateway_enabled is true."
    }
    precondition {
      condition     = !var.swarm_gateway_enabled || var.swarm_gateway_image_uri != ""
      error_message = "swarm_gateway_image_uri must be pinned before swarm_gateway_enabled is true."
    }
    precondition {
      condition     = var.swarm_gateway_backend_context_tokens <= var.max_model_len
      error_message = "swarm_gateway_backend_context_tokens must fit inside max_model_len."
    }
    precondition {
      condition     = var.swarm_gateway_context_safety_tokens + 512 < var.swarm_gateway_backend_context_tokens
      error_message = "The Swarm gateway context reserve must leave room for evidence and stage output."
    }
    precondition {
      condition = (
        var.platform_vpc_id == "" &&
        var.platform_vpc_cidr == "" &&
        length(var.platform_route_table_ids) == 0 &&
        var.platform_ecs_security_group_id == ""
        ) || (
        var.platform_vpc_id != "" &&
        var.platform_vpc_cidr != "" &&
        length(var.platform_route_table_ids) > 0 &&
        var.platform_ecs_security_group_id != ""
      )
      error_message = "Platform peering inputs must either all be empty or all be populated."
    }
    precondition {
      condition     = var.monthly_budget_usd == 0 || var.budget_email != ""
      error_message = "budget_email is required when monthly_budget_usd is non-zero."
    }
  }
}

locals {
  name             = "amos-qwen-${var.environment}"
  model_key_prefix = "models/${replace(var.model_repository, "/", "--")}/${var.model_revision}"
  endpoint_services = toset([
    "ec2messages",
    "ecr.api",
    "ecr.dkr",
    "secretsmanager",
    "ssm",
    "ssmmessages"
  ])
}

resource "aws_kms_key" "inference" {
  description             = "Encryption for ${local.name} artifacts, secrets, and volumes"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "inference" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.inference.key_id
}

resource "aws_vpc" "inference" {
  cidr_block           = "10.86.0.0/24"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = local.name }
}

resource "aws_subnet" "private" {
  vpc_id                  = aws_vpc.inference.id
  availability_zone       = var.availability_zone
  cidr_block              = "10.86.0.0/26"
  map_public_ip_on_launch = false

  tags = { Name = "${local.name}-private" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.inference.id
  tags   = { Name = "${local.name}-private" }
}

resource "aws_route_table_association" "private" {
  route_table_id = aws_route_table.private.id
  subnet_id      = aws_subnet.private.id
}

resource "aws_security_group" "inference" {
  name        = "${local.name}-instance"
  description = "No inbound traffic; inference is reached through SSM port forwarding"
  vpc_id      = aws_vpc.inference.id

  egress {
    description = "TLS to VPC endpoints and the S3 gateway endpoint"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    # Ingress is governed by standalone, narrowly scoped rules below.
    ignore_changes = [ingress]
  }
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-endpoints"
  description = "Private AWS API endpoints used by the inference instance"
  vpc_id      = aws_vpc.inference.id

  ingress {
    description     = "TLS from the inference instance"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.inference.id]
  }

  lifecycle {
    ignore_changes = [ingress]
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.endpoint_services

  vpc_id              = aws_vpc.inference.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [aws_subnet.private.id]
  security_group_ids  = [aws_security_group.endpoints.id]

  tags = { Name = "${local.name}-${replace(each.key, ".", "-")}" }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.inference.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "${local.name}-s3" }
}

resource "aws_s3_bucket" "models" {
  bucket        = "${local.name}-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "models" {
  bucket = aws_s3_bucket.models.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "models" {
  bucket = aws_s3_bucket.models.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.inference.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "models" {
  bucket                  = aws_s3_bucket.models.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_ecr_repository" "vllm" {
  name                 = "${local.name}/vllm-openai"
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.inference.arn
  }

  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "vllm" {
  repository = aws_ecr_repository.vllm.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest five pinned runtime images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_repository" "swarm_gateway" {
  name                 = "${local.name}/swarm-mission-gateway"
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.inference.arn
  }

  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "swarm_gateway" {
  repository = aws_ecr_repository.swarm_gateway.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest ten immutable gateway images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_secretsmanager_secret" "api_key" {
  name                    = "${local.name}/vllm-api-key"
  description             = "Bearer token for the private AMOS Qwen endpoint"
  kms_key_id              = aws_kms_key.inference.arn
  recovery_window_in_days = 30
}

resource "aws_iam_role" "inference" {
  name = "${local.name}-instance"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.inference.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "inference" {
  name = "${local.name}-artifacts"
  role = aws_iam_role.inference.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadPinnedModel"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket"]
        Resource = [aws_s3_bucket.models.arn, "${aws_s3_bucket.models.arn}/${local.model_key_prefix}/*"]
      },
      {
        Sid      = "ReadEndpointSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.api_key.arn]
      },
      {
        Sid      = "DecryptArtifacts"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.inference.arn]
      },
      {
        Sid      = "EcrAuthorization"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid      = "PullPinnedRuntime"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = [aws_ecr_repository.vllm.arn, aws_ecr_repository.swarm_gateway.arn]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "inference" {
  name = "${local.name}-instance"
  role = aws_iam_role.inference.name
}

resource "aws_instance" "inference" {
  count = var.inference_enabled ? 1 : 0

  ami                         = var.ami_id
  instance_type               = var.instance_type
  availability_zone           = var.availability_zone
  subnet_id                   = aws_subnet.private.id
  associate_public_ip_address = false
  vpc_security_group_ids      = [aws_security_group.inference.id]
  iam_instance_profile        = aws_iam_instance_profile.inference.name
  monitoring                  = true
  ebs_optimized               = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gib
    encrypted             = true
    kms_key_id            = aws_kms_key.inference.arn
    delete_on_termination = true
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    aws_region             = var.aws_region
    api_key_secret_id      = aws_secretsmanager_secret.api_key.id
    ecr_registry           = split("/", aws_ecr_repository.vllm.repository_url)[0]
    model_bucket           = aws_s3_bucket.models.id
    model_key_prefix       = local.model_key_prefix
    model_manifest_sha256  = var.model_manifest_sha256
    mtp_speculative_tokens = var.mtp_speculative_tokens
    max_model_len          = var.max_model_len
    max_num_batched_tokens = var.max_num_batched_tokens
    max_num_seqs           = var.max_num_seqs
    gpu_memory_utilization = var.gpu_memory_utilization
    served_model_name      = var.served_model_name
    vllm_image_uri         = var.vllm_image_uri
  })

  depends_on = [
    aws_s3_bucket_server_side_encryption_configuration.models,
    aws_s3_bucket_public_access_block.models,
    aws_vpc_endpoint.interface,
    aws_vpc_endpoint.s3
  ]

  tags = { Name = local.name }

  lifecycle {
    prevent_destroy = true
    # Live service changes use SSM so adding the gateway can never recycle the
    # shared GPU instance. The template remains authoritative for a new cell.
    ignore_changes = [user_data]

    precondition {
      condition     = var.availability_zone == "${var.aws_region}b" || var.aws_region != "us-east-1"
      error_message = "The qualified us-east-1 G7e cell currently targets us-east-1b."
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "instance_status" {
  count = var.inference_enabled ? 1 : 0

  alarm_name          = "${local.name}-instance-status"
  alarm_description   = "The Qwen inference instance failed an EC2 status check"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  dimensions          = { InstanceId = aws_instance.inference[0].id }
}

resource "aws_budgets_budget" "research" {
  count = var.monthly_budget_usd > 0 ? 1 : 0

  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Application$amos-qwen-research"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}

resource "aws_vpc_peering_connection" "platform" {
  count = var.platform_vpc_id == "" ? 0 : 1

  vpc_id      = aws_vpc.inference.id
  peer_vpc_id = var.platform_vpc_id
  auto_accept = true

  tags = { Name = "${local.name}-platform" }
}

resource "aws_route" "to_platform" {
  count = var.platform_vpc_id == "" ? 0 : 1

  route_table_id            = aws_route_table.private.id
  destination_cidr_block    = var.platform_vpc_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.platform[0].id
}

resource "aws_route" "from_platform" {
  count = var.platform_vpc_id == "" ? 0 : length(var.platform_route_table_ids)

  route_table_id            = var.platform_route_table_ids[count.index]
  destination_cidr_block    = aws_vpc.inference.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.platform[0].id
}

resource "aws_security_group_rule" "platform_vllm" {
  count = var.platform_ecs_security_group_id == "" ? 0 : 1

  type                     = "ingress"
  description              = "Hosted AMOS platform ECS to private Qwen vLLM"
  from_port                = 8000
  to_port                  = 8000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.inference.id
  source_security_group_id = var.platform_ecs_security_group_id

  depends_on = [aws_vpc_peering_connection.platform]
}

resource "aws_security_group_rule" "platform_swarm_gateway" {
  count = var.swarm_gateway_enabled ? 1 : 0

  type                     = "ingress"
  description              = "AMOS Platform Mission worker to private Swarm gateway"
  from_port                = var.swarm_gateway_port
  to_port                  = var.swarm_gateway_port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.inference.id
  source_security_group_id = var.platform_ecs_security_group_id

  depends_on = [aws_vpc_peering_connection.platform]
}

resource "aws_ssm_document" "swarm_gateway" {
  count = var.swarm_gateway_enabled ? 1 : 0

  name            = "${local.name}-install-swarm-mission-gateway"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Install the AMOS Swarm Mission gateway without restarting vLLM"
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "installSwarmGateway"
      inputs = {
        timeoutSeconds = "900"
        runCommand = [templatefile("${path.module}/templates/install-swarm-gateway.sh.tftpl", {
          api_key_secret_id             = aws_secretsmanager_secret.api_key.id
          aws_region                    = var.aws_region
          ecr_registry                  = split("/", aws_ecr_repository.swarm_gateway.repository_url)[0]
          served_model_name             = var.served_model_name
          swarm_gateway_backend_context = var.swarm_gateway_backend_context_tokens
          swarm_gateway_context_safety  = var.swarm_gateway_context_safety_tokens
          swarm_gateway_image_uri       = var.swarm_gateway_image_uri
          swarm_gateway_port            = var.swarm_gateway_port
        })]
      }
    }]
  })

  tags = { Name = "${local.name}-swarm-mission-gateway" }
}

resource "aws_ssm_association" "swarm_gateway" {
  count = var.swarm_gateway_enabled ? 1 : 0

  name                        = aws_ssm_document.swarm_gateway[0].name
  association_name            = "${local.name}-swarm-mission-gateway"
  apply_only_at_cron_interval = false

  targets {
    key    = "InstanceIds"
    values = [aws_instance.inference[0].id]
  }

  depends_on = [aws_iam_role_policy.inference]
}

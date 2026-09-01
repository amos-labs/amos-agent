variable "aws_region" {
  description = "Region containing the private Qwen inference cell."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "Availability zone shared with the Qwen inference cell."
  type        = string
  default     = "us-east-1b"
}

variable "environment" {
  description = "Short environment label used in resource names."
  type        = string
  default     = "research"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.environment))
    error_message = "environment must be a short lowercase identifier."
  }
}

variable "runner_enabled" {
  description = "Create the always-on CPU research runner after its image is pinned."
  type        = bool
  default     = false
}

variable "runner_ami_id" {
  description = "Pinned Amazon Linux 2023 AMI for the CPU runner."
  type        = string
  default     = "ami-0332d564d76dbd8d6"

  validation {
    condition     = can(regex("^ami-[a-f0-9]+$", var.runner_ami_id))
    error_message = "runner_ami_id must be a pinned AMI ID."
  }
}

variable "runner_instance_type" {
  description = "CPU runner used for Harbor, collection, and cloud job control."
  type        = string
  default     = "t3.large"
}

variable "runner_root_volume_gib" {
  description = "Encrypted runner capacity for Docker task images and transient jobs."
  type        = number
  default     = 150
}

variable "runner_image_uri" {
  description = "Immutable ECR runner image URI ending in @sha256:..."
  type        = string
  default     = ""

  validation {
    condition     = var.runner_image_uri == "" || can(regex("@sha256:[a-f0-9]{64}$", var.runner_image_uri))
    error_message = "runner_image_uri must be empty or an immutable ECR digest."
  }
}

variable "served_model_name" {
  description = "Model ID expected from the private vLLM endpoint."
  type        = string
  default     = "amos-qwen38-27b-fp8"
}

variable "inference_name" {
  description = "Name of the existing Qwen inference cell."
  type        = string
  default     = "amos-qwen-research"
}

variable "max_job_receive_count" {
  description = "Attempts before a failed research job moves to the dead-letter queue."
  type        = number
  default     = 3
}

variable "trainer_enabled" {
  description = "Create one disposable GPU trainer for an immutable stage-zero contract."
  type        = bool
  default     = false
}

variable "trainer_ami_id" {
  description = "Pinned AWS Deep Learning Base OSS Nvidia Driver AMI used by the disposable trainer."
  type        = string
  default     = ""

  validation {
    condition     = var.trainer_ami_id == "" || can(regex("^ami-[a-f0-9]+$", var.trainer_ami_id))
    error_message = "trainer_ami_id must be empty or a pinned AMI ID."
  }
}

variable "trainer_instance_type" {
  description = "Single-GPU instance for the initial QLoRA lineage proof."
  type        = string
  default     = "g7e.2xlarge"
}

variable "trainer_root_volume_gib" {
  description = "Encrypted transient storage for the image, canonical checkpoint, dataset, and adapter."
  type        = number
  default     = 350
}

variable "trainer_image_uri" {
  description = "Immutable ECR trainer image URI ending in @sha256:..."
  type        = string
  default     = ""

  validation {
    condition     = var.trainer_image_uri == "" || can(regex("@sha256:[a-f0-9]{64}$", var.trainer_image_uri))
    error_message = "trainer_image_uri must be empty or an immutable ECR digest."
  }
}

variable "trainer_contract_uri" {
  description = "Immutable S3 URI for the generated stage-zero training contract."
  type        = string
  default     = ""

  validation {
    condition     = var.trainer_contract_uri == "" || can(regex("^s3://[a-z0-9.-]+/[A-Za-z0-9!_.*'()/-]+\\.json$", var.trainer_contract_uri))
    error_message = "trainer_contract_uri must be empty or a bounded s3:// JSON object URI."
  }
}

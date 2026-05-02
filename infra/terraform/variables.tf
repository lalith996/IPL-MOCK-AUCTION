variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "ipl-auction"
}

variable "environment" {
  description = "Deployment environment: staging | production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "aws_region" {
  description = "AWS region (India: ap-south-1)"
  type        = string
  default     = "ap-south-1"
}

variable "domain_name" {
  description = "Root domain for the auction app (e.g. ipl-auction.example.com)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of AZs to provision subnets in"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
}

variable "postgres_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"  # upgrade to db.r7g.large for production
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t3.micro"  # upgrade to cache.r7g.large for production
}

variable "eks_node_groups" {
  description = "EKS managed node group configurations"
  type = map(object({
    instance_types  = list(string)
    min_size        = number
    desired_size    = number
    max_size        = number
    capacity_type   = string  # ON_DEMAND | SPOT
  }))
  default = {
    general = {
      instance_types = ["t3.medium"]
      min_size       = 2
      desired_size   = 3
      max_size       = 10
      capacity_type  = "ON_DEMAND"
    }
    spot = {
      instance_types = ["t3.large", "t3a.large", "m5.large"]
      min_size       = 0
      desired_size   = 0
      max_size       = 10
      capacity_type  = "SPOT"
    }
  }
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.cluster_id}-sg"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
  name   = "${var.cluster_id}-redis-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = var.allowed_sg_ids
  }
  egress {
    from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_parameter_group" "redis7" {
  name   = "${var.cluster_id}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = var.cluster_id
  description          = "IPL Auction Redis"

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_clusters   = var.environment == "production" ? 2 : 1

  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  parameter_group_name       = aws_elasticache_parameter_group.redis7.name

  at_rest_encryption_enabled = var.at_rest_encryption
  transit_encryption_enabled = var.transit_encryption
  auth_token                 = var.transit_encryption ? random_password.redis_auth.result : null

  automatic_failover_enabled = var.environment == "production"
  multi_az_enabled           = var.environment == "production"

  snapshot_retention_limit = var.environment == "production" ? 5 : 1
  snapshot_window          = "03:30-04:30"
  maintenance_window       = "sun:05:00-sun:06:00"
}

resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "redis_auth" {
  count = var.transit_encryption ? 1 : 0
  name  = "/ipl-auction/${var.environment}/redis-auth-token"
  type  = "SecureString"
  value = random_password.redis_auth.result
}

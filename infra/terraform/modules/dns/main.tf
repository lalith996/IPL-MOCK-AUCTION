resource "aws_route53_zone" "main" {
  name = var.domain_name
  tags = { Environment = var.environment }
}

# ACM cert for the web/admin/ws domains (ap-south-1)
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = [
    "*.${var.domain_name}",
    "cdn.${var.domain_name}",
  ]
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

# ACM cert for CloudFront (must be us-east-1)
resource "aws_acm_certificate" "cdn" {
  provider                  = aws.us_east_1
  domain_name               = "cdn.${var.domain_name}"
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# Auto-validate via Route53
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

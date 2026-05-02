output "zone_id"        { value = aws_route53_zone.main.zone_id }
output "nameservers"    { value = aws_route53_zone.main.name_servers }
output "cert_arn"       { value = aws_acm_certificate_validation.main.certificate_arn }
output "cdn_cert_arn"   { value = aws_acm_certificate.cdn.arn }

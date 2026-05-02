variable "cluster_id"          { type = string }
variable "engine_version"      { type = string }
variable "node_type"           { type = string }
variable "vpc_id"              { type = string }
variable "subnet_ids"          { type = list(string) }
variable "allowed_sg_ids"      { type = list(string) }
variable "at_rest_encryption"  { type = bool; default = true }
variable "transit_encryption"  { type = bool; default = true }
variable "environment"         { type = string }

data "aws_availability_zones" "available" { state = "available" }
data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}
resource "aws_vpc" "vpn" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-${var.region}" }
}
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.vpn.id
  cidr_block              = cidrsubnet(var.cidr, 8, 0)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
}
resource "aws_internet_gateway" "vpn" { vpc_id = aws_vpc.vpn.id }
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.vpn.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.vpn.id
  }
}
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
resource "aws_security_group" "vpn" {
  name_prefix = "${var.project}-vpn-"
  vpc_id      = aws_vpc.vpn.id
  description = "OpenVPN UDP and TCP fallback only. DNS, Pi-hole admin, SSH, and metadata are not public."
  dynamic "ingress" {
    for_each = var.ingress_cidrs
    content {
      description = "OpenVPN clients"
      protocol    = "udp"
      from_port   = 1194
      to_port     = 1194
      cidr_blocks = [ingress.value]
    }
  }
  dynamic "ingress" {
    for_each = var.ingress_cidrs
    content {
      description = "OpenVPN TCP fallback with TLS control-channel encryption"
      protocol    = "tcp"
      from_port   = 443
      to_port     = 443
      cidr_blocks = [ingress.value]
    }
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_iam_role" "gateway" {
  name = "${var.project}-gateway-${var.region}"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.gateway.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "profile_delivery" {
  role = aws_iam_role.gateway.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject"], Resource = "${var.bucket_arn}/profiles/${var.region}/*" }]
  })
}
resource "aws_iam_instance_profile" "gateway" { role = aws_iam_role.gateway.name }
resource "aws_eip" "gateway" { domain = "vpc" }
resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public.availability_zone
  type              = "gp3"
  size              = 10
  encrypted         = true
  tags              = { Name = "${var.project}-pki-${var.region}", NavalnyBackup = "true" }
  lifecycle { prevent_destroy = true }
}
resource "aws_instance" "gateway" {
  ami                         = nonsensitive(data.aws_ssm_parameter.ubuntu.value)
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.vpn.id]
  iam_instance_profile        = aws_iam_instance_profile.gateway.name
  source_dest_check           = false
  user_data_replace_on_change = true
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }
  credit_specification { cpu_credits = "standard" }
  root_block_device {
    volume_size = 16
    volume_type = "gp3"
    encrypted   = true
  }
  user_data_base64 = base64gzip("#cloud-config\n${yamlencode({
    write_files = [
      { path = "/etc/navalnyvpn/node.json", permissions = "0600", content = jsonencode({
        volumeId       = aws_ebs_volume.data.id, publicIp = aws_eip.gateway.public_ip, region = var.region
        artifactBucket = var.bucket_name, artifactRegion = var.artifact_region, piholeImage = var.pihole_image
      }) },
      { path = "/usr/local/sbin/navalny-mount-data", permissions = "0700", content = file("${path.module}/../../../deploy/mount-data.sh") },
      { path = "/usr/local/sbin/navalny-profile", permissions = "0700", content = file("${path.module}/../../../deploy/profile.sh") },
      { path = "/usr/local/sbin/navalny-firewall", permissions = "0700", content = file("${path.module}/../../../deploy/firewall.sh") },
      { path = "/usr/local/sbin/navalny-bootstrap", permissions = "0700", content = file("${path.module}/../../../deploy/gateway-bootstrap.sh") }
    ]
    runcmd = [["bash", "/usr/local/sbin/navalny-bootstrap"]]
  })}")
  tags       = { Name = "${var.project}-gateway-${var.region}" }
  depends_on = [aws_route_table_association.public, aws_iam_role_policy_attachment.ssm, aws_iam_role_policy.profile_delivery]
}
resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.gateway.id
}
resource "aws_eip_association" "gateway" {
  allocation_id = aws_eip.gateway.id
  instance_id   = aws_instance.gateway.id
}
resource "aws_ssm_document" "profile" {
  name          = "${var.project}-gateway-${var.region}"
  document_type = "Command"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Issue or revoke a NavalnyVPN device certificate without returning secrets."
    parameters = {
      Action    = { type = "String", allowedValues = ["issue", "revoke", "health"] }
      ProfileId = { type = "String", allowedPattern = "^(nv-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|health)$" }
    }
    mainSteps = [{
      action = "aws:runShellScript", name = "ManageProfile"
      inputs = { timeoutSeconds = "180", runCommand = ["/usr/local/sbin/navalny-profile {{ Action }} {{ ProfileId }}"] }
    }]
  })
}
output "gateway" {
  value = {
    id           = var.region, instanceId = aws_instance.gateway.id, documentName = aws_ssm_document.profile.name
    publicIp     = aws_eip.gateway.public_ip
    instanceArn  = aws_instance.gateway.arn
    documentArn  = aws_ssm_document.profile.arn
    dataVolumeId = aws_ebs_volume.data.id
  }
}
output "subnet_id" { value = aws_subnet.public.id }
output "vpc_id" { value = aws_vpc.vpn.id }
output "availability_zone" { value = aws_subnet.public.availability_zone }
output "public_route_table_id" { value = aws_route_table.public.id }
output "ami" { value = nonsensitive(data.aws_ssm_parameter.ubuntu.value) }

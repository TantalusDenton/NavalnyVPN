resource "aws_iam_role" "control" {
  name = "${var.project}-control"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "control_ssm" {
  role       = aws_iam_role.control.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "control" {
  role = aws_iam_role.control.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "GatewayOperations", Effect = "Allow", Action = ["ssm:SendCommand"], Resource = concat([for g in local.gateways : g.instanceArn], [for g in local.gateways : g.documentArn]) },
      # GetCommandInvocation has no resource-level authorization in AWS.
      { Sid = "ReadCommandStatus", Effect = "Allow", Action = ["ssm:GetCommandInvocation"], Resource = "*" },
      { Sid = "RetrieveProfiles", Effect = "Allow", Action = ["s3:GetObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.artifacts.arn}/profiles/*" },
      { Sid = "ReadRelease", Effect = "Allow", Action = ["s3:GetObject"], Resource = aws_s3_object.app.arn }
    ]
  })
}
resource "aws_iam_instance_profile" "control" { role = aws_iam_role.control.name }
resource "aws_security_group" "control" {
  name_prefix = "${var.project}-portal-"
  vpc_id      = module.virginia.vpc_id
  description = "HTTPS portal and ACME HTTP validation. API and SSH are private."
  ingress {
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_eip" "control" { domain = "vpc" }
resource "aws_ebs_volume" "control_data" {
  availability_zone = module.virginia.availability_zone
  type              = "gp3"
  size              = 10
  encrypted         = true
  tags              = { Name = "${var.project}-accounts", NavalnyBackup = "true" }
  lifecycle { prevent_destroy = true }
}
locals {
  runtime = {
    origin = "https://${var.domain}", authMode = "cognito", provisioner = "aws"
    cognito = {
      userPoolId = aws_cognito_user_pool.users.id
      clientId   = aws_cognito_user_pool_client.web.id
      domain     = "https://${aws_cognito_user_pool_domain.auth.domain}.auth.us-east-1.amazoncognito.com"
    }
    artifactBucket = aws_s3_bucket.artifacts.id, artifactRegion = "us-east-1"
    regions        = [for g in local.gateways : { id = g.id, name = g.name, country = g.country, code = g.code, continent = g.continent, instanceId = g.instanceId, documentName = g.documentName }]
  }
}
resource "aws_instance" "control" {
  ami                         = module.virginia.ami
  instance_type               = var.control_instance_type
  subnet_id                   = module.virginia.subnet_id
  vpc_security_group_ids      = [aws_security_group.control.id]
  iam_instance_profile        = aws_iam_instance_profile.control.name
  user_data_replace_on_change = true
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }
  credit_specification { cpu_credits = "standard" }
  root_block_device {
    volume_size = 24
    volume_type = "gp3"
    encrypted   = true
  }
  user_data_base64 = base64gzip("#cloud-config\n${yamlencode({
    write_files = [
      { path = "/etc/navalnyvpn/node.json", permissions = "0600", content = jsonencode({
        volumeId       = aws_ebs_volume.control_data.id, artifactBucket = aws_s3_bucket.artifacts.id
        artifactRegion = "us-east-1", archiveKey = aws_s3_object.app.key
      }) },
      { path = "/etc/navalnyvpn/runtime.json", permissions = "0644", content = jsonencode(local.runtime) },
      { path = "/usr/local/sbin/navalny-mount-data", permissions = "0700", content = file("${path.module}/../deploy/mount-data.sh") },
      { path = "/usr/local/sbin/navalny-bootstrap", permissions = "0700", content = file("${path.module}/../deploy/control-bootstrap.sh") },
      { path = "/etc/navalnyvpn/Caddyfile", permissions = "0644", content = "${var.domain} {\n  encode zstd gzip\n  reverse_proxy 127.0.0.1:3001\n  header Strict-Transport-Security \"max-age=31536000; includeSubDomains\"\n}\n" }
    ]
    runcmd = [["bash", "/usr/local/sbin/navalny-bootstrap"]]
  })}")
  tags       = { Name = "${var.project}-portal" }
  depends_on = [aws_iam_role_policy.control, aws_iam_role_policy_attachment.control_ssm, aws_cognito_managed_login_branding.web]
}
resource "aws_volume_attachment" "control_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.control_data.id
  instance_id = aws_instance.control.id
}
resource "aws_eip_association" "control" {
  allocation_id = aws_eip.control.id
  instance_id   = aws_instance.control.id
}

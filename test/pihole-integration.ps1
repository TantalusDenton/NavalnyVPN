$ErrorActionPreference = 'Stop'
$containerName = 'navalnyvpn-pihole-check-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
function Invoke-TestDocker {
    $dockerArguments = @($args)
    $result = & docker @dockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker test command failed with exit code $LASTEXITCODE" }
    return $result
}
try {
    Invoke-TestDocker run --rm -d --name $containerName `
      -e FTLCONF_dns_listeningMode=ALL -e FTLCONF_dns_upstreams=1.1.1.1 `
      -e FTLCONF_dns_queryLogging=false -e FTLCONF_database_maxDBdays=0 `
      -e FTLCONF_misc_privacylevel=3 -e FTLCONF_webserver_port=127.0.0.1:8080 `
      -e FTLCONF_ntp_ipv4_active=false -e FTLCONF_ntp_ipv6_active=false `
      -e FTLCONF_webserver_api_password=integration-fixture-only `
      pihole/pihole:2026.09.0 | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $status = & docker exec $containerName pihole-FTL --config misc.privacylevel 2>$null
        if ($LASTEXITCODE -eq 0 -and "$status".Trim() -eq '3') {
            $entries = & docker exec $containerName pihole-FTL sqlite3 /etc/pihole/gravity.db "SELECT value FROM info WHERE property='gravity_count';" 2>$null
            if ($LASTEXITCODE -eq 0 -and "$entries".Trim() -match '^[1-9][0-9]*$') { $ready = $true; break }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Pi-hole did not become ready' }
    $queryHistory = Invoke-TestDocker exec $containerName pihole-FTL --config database.maxDBdays
    if ("$queryHistory".Trim() -ne '0') { throw 'Query history must be disabled' }
    $adminPort = Invoke-TestDocker exec $containerName pihole-FTL --config webserver.port
    if ("$adminPort".Trim() -ne '127.0.0.1:8080') { throw 'Admin UI must bind only to loopback' }
    $sql = @'
INSERT OR IGNORE INTO adlist (address,enabled,comment) VALUES
('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt',1,'HaGeZi ads and trackers'),
('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt',1,'HaGeZi adult domains');
INSERT OR IGNORE INTO adlist_by_group (adlist_id,group_id) SELECT id,0 FROM adlist;
'@
    Invoke-TestDocker exec $containerName pihole-FTL sqlite3 /etc/pihole/gravity.db $sql | Out-Null
    Invoke-TestDocker exec $containerName pihole -g | Out-Null
    $listCount = Invoke-TestDocker exec $containerName pihole-FTL sqlite3 /etc/pihole/gravity.db "SELECT COUNT(*) FROM adlist WHERE enabled=1 AND (number+abp_entries)>0 AND comment IN ('HaGeZi ads and trackers','HaGeZi adult domains');"
    if ("$listCount".Trim() -ne '2') {
        Invoke-TestDocker exec $containerName pihole-FTL sqlite3 /etc/pihole/gravity.db 'SELECT address,comment,number,abp_entries,status FROM adlist;'
        throw 'Both required domain lists must load successfully'
    }
    $normal = Invoke-TestDocker run --rm --network "container:$containerName" navalnyvpn-gateway:test /usr/bin/dig +short +time=3 '@127.0.0.1' example.com A
    if (-not $normal -or "$normal" -match 'timed out|no servers') { throw 'Normal DNS resolution failed' }
    foreach ($domain in @('doubleclick.net', 'pornhub.com')) {
        $didBlock = $false
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            $blocked = Invoke-TestDocker run --rm --network "container:$containerName" navalnyvpn-gateway:test /usr/bin/dig +short +time=3 '@127.0.0.1' $domain A
            if ("$blocked".Trim() -eq '0.0.0.0') { $didBlock = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $didBlock) { throw "Expected a blocked DNS response for $domain" }
    }
    Write-Output 'PASS: normal DNS resolves; ad and adult domains are blocked'
    Write-Output 'PASS: query history is disabled and the admin UI binds to loopback'
} finally {
    & docker rm -f $containerName 2>$null | Out-Null
}

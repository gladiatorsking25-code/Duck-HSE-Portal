# static-server.ps1 - the local dev server for the Duck HSE Portal.
#
# WHY POWERSHELL AND NOT NODE:
# The portal is a static, installable PWA. It has no build step, no bundler and
# no server-side rendering - it ships to GitHub Pages as plain files, and every
# feature (assessments, permits, checklists, and the admin control centre's HSE
# analytics) runs in the browser. Previewing it needs nothing more than a file
# server that sets correct MIME types, which is what this is. PowerShell ships
# with Windows, so the preview works on a clean machine with nothing installed.
#
# This is NOT server/index.mjs. That is the legacy Google Sheets backend - an
# older auth/storage path that predates Firebase. It needs Node 22, an npm
# install, a .env file and a Google service-account key (see START-HERE.txt and
# GOOGLE_SHEETS_SETUP.md). The app runs in Firebase real-accounts mode now, so
# it is not required to preview or develop the front end. If you do want it,
# install Node.js 22+ and run START-PORTAL.cmd - it is unaffected by this file.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File server/static-server.ps1 -Port 3000
# Wired into .claude/launch.json so `preview_start` just works.

param(
    [int]$Port = 3000,
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"

# Default to the repo root (this script lives in server/).
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent $PSScriptRoot
}
$Root = (Resolve-Path -LiteralPath $Root).ProviderPath

# Content types the portal actually serves. Getting these wrong is not cosmetic:
# a stylesheet sent as text/plain is ignored, a module sent as the wrong type is
# refused, and the service worker will not register unless sw.js is JavaScript.
$MimeTypes = @{
    ".html"        = "text/html; charset=utf-8"
    ".htm"         = "text/html; charset=utf-8"
    ".js"          = "text/javascript; charset=utf-8"
    ".mjs"         = "text/javascript; charset=utf-8"
    ".css"         = "text/css; charset=utf-8"
    ".json"        = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".map"         = "application/json; charset=utf-8"
    ".txt"         = "text/plain; charset=utf-8"
    ".md"          = "text/plain; charset=utf-8"
    ".csv"         = "text/csv; charset=utf-8"
    ".svg"         = "image/svg+xml"
    ".png"         = "image/png"
    ".jpg"         = "image/jpeg"
    ".jpeg"        = "image/jpeg"
    ".gif"         = "image/gif"
    ".webp"        = "image/webp"
    ".ico"         = "image/x-icon"
    ".woff"        = "font/woff"
    ".woff2"       = "font/woff2"
    ".ttf"         = "font/ttf"
    ".xlsx"        = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ".xlsm"        = "application/vnd.ms-excel.sheet.macroEnabled.12"
    ".pdf"         = "application/pdf"
    ".zip"         = "application/zip"
}

function Get-ContentType([string]$path) {
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($MimeTypes.ContainsKey($ext)) { return $MimeTypes[$ext] }
    return "application/octet-stream"
}

$listener = New-Object System.Net.HttpListener
# localhost and 127.0.0.1 are both non-wildcard prefixes, so neither needs an
# administrator token the way "http://+:$Port/" would.
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.IgnoreWriteExceptions = $true

try {
    $listener.Start()
} catch {
    Write-Output "FAILED to bind port $Port : $($_.Exception.Message)"
    Write-Output "Another process is probably already using it. Close it, or start this script with -Port <other>."
    exit 1
}

Write-Output "Duck HSE Portal dev server"
Write-Output "  serving : $Root"
Write-Output "  address : http://localhost:$Port/"
Write-Output "  ready   - press Ctrl+C or use preview_stop to end it."

while ($listener.IsListening) {
    $context = $null
    try {
        $context = $listener.GetContext()
    } catch {
        # Listener stopped while blocked in GetContext - normal on shutdown.
        break
    }

    try {
        $request = $context.Request
        $response = $context.Response

        $relative = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }
        $relative = $relative -replace '/', '\'

        # Credentials and environment files are never served, even locally.
        if ($relative -match '(^|\\)(service-account[^\\]*\.json|\.env(\.[^\\]*)?|[^\\]*\.(pem|p12|key|keystore|jks))$') {
            $relative = '__blocked__'
        }

        $candidate = Join-Path $Root $relative
        # A directory request serves its index.html, matching GitHub Pages.
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            $candidate = Join-Path $candidate "index.html"
        }

        # Resolve before serving and confirm the result is still inside the repo,
        # so "../../" in a URL cannot walk out of it.
        $full = $null
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $full = (Resolve-Path -LiteralPath $candidate).ProviderPath
            if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $full = $null
            }
        }

        if ($full) {
            $bytes = [System.IO.File]::ReadAllBytes($full)
            $response.StatusCode = 200
            $response.ContentType = Get-ContentType $full
            # No caching in dev: an edit should be live on the next reload
            # rather than hidden behind the browser or the service worker.
            $response.Headers.Add("Cache-Control", "no-store, must-revalidate")
            if ($request.HttpMethod -eq "HEAD") {
                $response.ContentLength64 = $bytes.Length
            } else {
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            Write-Output "$($response.StatusCode) $($request.HttpMethod) /$($relative -replace '\\','/')"
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: /$($relative -replace '\\','/')")
            $response.StatusCode = 404
            $response.ContentType = "text/plain; charset=utf-8"
            $response.ContentLength64 = $body.Length
            $response.OutputStream.Write($body, 0, $body.Length)
            Write-Output "404 $($request.HttpMethod) /$($relative -replace '\\','/')"
        }
    } catch {
        Write-Output "ERROR handling request: $($_.Exception.Message)"
    } finally {
        if ($context) { try { $context.Response.Close() } catch { } }
    }
}

try { $listener.Stop() } catch { }
try { $listener.Close() } catch { }

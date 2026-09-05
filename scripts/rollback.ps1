param(
  [Parameter(Mandatory = $true)]
  [string]$TargetRoot,
  [string]$PatchPath = (Join-Path $PSScriptRoot 'change.patch'),
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$expectedBase = '5833494e6fdc16201cc10ec8776578892e8d85b4'
$target = (Resolve-Path -LiteralPath $TargetRoot).Path
$patch = (Resolve-Path -LiteralPath $PatchPath).Path

if (-not (Test-Path -LiteralPath (Join-Path $target '.git'))) {
  throw 'rollback_target_not_git_repository'
}

$top = (& git -C $target rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [System.IO.Path]::GetFullPath($top) -ne [System.IO.Path]::GetFullPath($target)) {
  throw 'rollback_target_root_mismatch'
}

$head = (& git -C $target rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $expectedBase) {
  throw 'rollback_base_commit_mismatch'
}

& git -C $target apply --reverse --check --binary --whitespace=nowarn $patch
if ($LASTEXITCODE -ne 0) {
  throw 'rollback_reverse_check_failed'
}

if ($DryRun) {
  [ordered]@{
    schemaVersion = 'designsignal.rollback-receipt.v1'
    mode = 'dry-run'
    targetCommit = $head
    patch = [System.IO.Path]::GetFileName($patch)
    reverseCheck = 'passed'
    applied = $false
  } | ConvertTo-Json -Depth 4
  exit 0
}

& git -C $target apply --reverse --binary --whitespace=nowarn $patch
if ($LASTEXITCODE -ne 0) {
  throw 'rollback_reverse_apply_failed'
}

& git -C $target diff --exit-code $expectedBase -- .
if ($LASTEXITCODE -ne 0) {
  throw 'rollback_code_diff_remaining'
}

$status = (& git -C $target status --porcelain --untracked-files=all) -join "`n"
if ($LASTEXITCODE -ne 0 -or $status.Trim()) {
  throw 'rollback_worktree_not_clean'
}

[ordered]@{
  schemaVersion = 'designsignal.rollback-receipt.v1'
  mode = 'apply'
  targetCommit = $head
  patch = [System.IO.Path]::GetFileName($patch)
  reverseCheck = 'passed'
  applied = $true
  worktree = 'byte-identical-to-base'
} | ConvertTo-Json -Depth 4

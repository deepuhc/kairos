#!/bin/bash
# Kairos — Quick run with Claude Code
# No npm install needed. Just: ./run.sh "your task"
#
# Usage:
#   ./run.sh "review this code for security issues"
#   ./run.sh --parallel "research topic A" "research topic B" "research topic C"
#   ./run.sh --recipe recipes/code-review.yaml
#   ./run.sh --help

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KAIROS_DIR="${SCRIPT_DIR}"

# Colors (from DESIGN.md)
AMBER='\033[0;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "  ${BOLD}✦ Kairos${NC} — The Decisive Moment"
  echo ""
}

print_help() {
  print_header
  echo "  Usage:"
  echo "    ./run.sh \"task description\"              Run a single agent"
  echo "    ./run.sh --parallel \"task1\" \"task2\" ...  Run multiple agents in parallel"
  echo "    ./run.sh --sequential \"step1\" \"step2\"   Run agents in sequence (output chains)"
  echo "    ./run.sh --review                        Code review of current git diff"
  echo "    ./run.sh --help                          Show this help"
  echo ""
  echo "  Options:"
  echo "    --model MODEL    Claude model (default: current)"
  echo "    --dir DIR        Working directory (default: current)"
  echo "    --budget N       Max cost in USD (informational)"
  echo "    --quiet          Minimal output"
  echo ""
  echo "  Examples:"
  echo "    ./run.sh \"find all TODO comments and create a summary\""
  echo "    ./run.sh --parallel \"check for security issues\" \"check for performance issues\" \"check test coverage\""
  echo "    ./run.sh --sequential \"analyze the bug\" \"propose a fix\" \"write tests for the fix\""
  echo "    ./run.sh --review"
  echo ""
}

# Parse arguments
MODE="single"
MODEL=""
WORKDIR="$(pwd)"
QUIET=false
TASKS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --help|-h)
      print_help
      exit 0
      ;;
    --parallel)
      MODE="parallel"
      shift
      ;;
    --sequential)
      MODE="sequential"
      shift
      ;;
    --review)
      MODE="review"
      shift
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --dir)
      WORKDIR="$2"
      shift 2
      ;;
    --quiet)
      QUIET=true
      shift
      ;;
    --budget)
      # Informational only for now
      shift 2
      ;;
    *)
      TASKS+=("$1")
      shift
      ;;
  esac
done

# Build claude args
CLAUDE_ARGS="-p"
if [[ -n "$MODEL" ]]; then
  CLAUDE_ARGS="$CLAUDE_ARGS --model $MODEL"
fi

timestamp() {
  date +"%H:%M:%S"
}

run_single() {
  local task="$1"
  local id="${2:-agent-1}"

  if [[ "$QUIET" != true ]]; then
    echo -e "  ${AMBER}◉${NC} ${id}: ${DIM}working...${NC}"
  fi

  local start=$(date +%s)
  local output
  output=$(cd "$WORKDIR" && claude -p "$task" ${MODEL:+--model "$MODEL"} 2>/dev/null)
  local end=$(date +%s)
  local elapsed=$((end - start))

  if [[ "$QUIET" != true ]]; then
    echo -e "  ${GREEN}✓${NC} ${id}: done (${elapsed}s)"
  fi

  echo "$output"
}

run_parallel() {
  print_header
  echo -e "  Pattern: ${BOLD}parallel${NC} (${#TASKS[@]} agents)"
  echo ""

  local pids=()
  local tmpdir=$(mktemp -d)

  for i in "${!TASKS[@]}"; do
    local id="agent-$((i+1))"
    local task="${TASKS[$i]}"
    echo -e "  ${AMBER}◉${NC} ${id}: ${DIM}${task:0:60}${NC}"

    # Run in background, save output to temp file
    (cd "$WORKDIR" && claude -p "$task" ${MODEL:+--model "$MODEL"} 2>/dev/null > "$tmpdir/$id.out") &
    pids+=($!)
  done

  echo ""
  echo -e "  ${DIM}Waiting for ${#pids[@]} agents...${NC}"

  # Wait for all to complete
  local failed=0
  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
      echo -e "  ${GREEN}✓${NC} agent-$((i+1)): complete"
    else
      echo -e "  ${RED}✗${NC} agent-$((i+1)): failed"
      failed=$((failed+1))
    fi
  done

  echo ""
  echo -e "  ${BOLD}Results:${NC}"
  echo ""

  for i in "${!TASKS[@]}"; do
    local id="agent-$((i+1))"
    echo -e "  ${BOLD}── ${id} ──${NC}"
    if [[ -f "$tmpdir/$id.out" ]]; then
      cat "$tmpdir/$id.out"
    fi
    echo ""
  done

  rm -rf "$tmpdir"

  if [[ $failed -eq 0 ]]; then
    echo -e "  ${GREEN}✓ All ${#TASKS[@]} agents completed successfully${NC}"
  else
    echo -e "  ${RED}✗ $failed agent(s) failed${NC}"
  fi
}

run_sequential() {
  print_header
  echo -e "  Pattern: ${BOLD}sequential${NC} (${#TASKS[@]} phases)"
  echo ""

  local previous_output=""

  for i in "${!TASKS[@]}"; do
    local phase=$((i+1))
    local task="${TASKS[$i]}"

    # Chain previous output into next task
    local full_prompt="$task"
    if [[ -n "$previous_output" ]]; then
      full_prompt="Previous step output:
---
$previous_output
---

Now: $task"
    fi

    echo -e "  ${AMBER}◉${NC} Phase $phase: ${DIM}${task:0:60}${NC}"

    local start=$(date +%s)
    previous_output=$(cd "$WORKDIR" && claude -p "$full_prompt" ${MODEL:+--model "$MODEL"} 2>/dev/null)
    local end=$(date +%s)

    echo -e "  ${GREEN}✓${NC} Phase $phase: done ($((end-start))s)"
  done

  echo ""
  echo -e "  ${BOLD}Final Output:${NC}"
  echo ""
  echo "$previous_output"
}

run_review() {
  print_header
  echo -e "  Pattern: ${BOLD}parallel code review${NC}"
  echo ""

  local diff=$(cd "$WORKDIR" && git diff HEAD 2>/dev/null || git diff 2>/dev/null || echo "No changes found")

  if [[ "$diff" == "No changes found" ]]; then
    # Try staged changes
    diff=$(cd "$WORKDIR" && git diff --cached 2>/dev/null || echo "No changes found")
  fi

  if [[ "$diff" == "No changes found" ]]; then
    echo -e "  ${RED}No git changes detected.${NC} Stage or commit changes first."
    exit 1
  fi

  local tmpdir=$(mktemp -d)
  echo "$diff" > "$tmpdir/diff.txt"

  local security_prompt="Review this code diff for security vulnerabilities (injection, XSS, auth issues, secrets, OWASP Top 10). Be specific about line numbers and severity. Diff:

$diff"

  local logic_prompt="Review this code diff for logic errors, edge cases, race conditions, and correctness issues. Be specific. Diff:

$diff"

  local style_prompt="Review this code diff for style issues, naming, maintainability, and adherence to best practices. Be brief. Diff:

$diff"

  echo -e "  ${AMBER}◉${NC} security-reviewer: ${DIM}scanning for vulnerabilities...${NC}"
  echo -e "  ${AMBER}◉${NC} logic-reviewer: ${DIM}checking correctness...${NC}"
  echo -e "  ${AMBER}◉${NC} style-reviewer: ${DIM}reviewing style...${NC}"
  echo ""

  # Run all three in parallel
  (cd "$WORKDIR" && claude -p "$security_prompt" ${MODEL:+--model "$MODEL"} 2>/dev/null > "$tmpdir/security.out") &
  local pid1=$!
  (cd "$WORKDIR" && claude -p "$logic_prompt" ${MODEL:+--model "$MODEL"} 2>/dev/null > "$tmpdir/logic.out") &
  local pid2=$!
  (cd "$WORKDIR" && claude -p "$style_prompt" ${MODEL:+--model "$MODEL"} 2>/dev/null > "$tmpdir/style.out") &
  local pid3=$!

  wait $pid1 && echo -e "  ${GREEN}✓${NC} security-reviewer: done" || echo -e "  ${RED}✗${NC} security-reviewer: failed"
  wait $pid2 && echo -e "  ${GREEN}✓${NC} logic-reviewer: done" || echo -e "  ${RED}✗${NC} logic-reviewer: failed"
  wait $pid3 && echo -e "  ${GREEN}✓${NC} style-reviewer: done" || echo -e "  ${RED}✗${NC} style-reviewer: failed"

  echo ""

  # Synthesize
  local all_reviews="Security Review:
$(cat "$tmpdir/security.out" 2>/dev/null)

Logic Review:
$(cat "$tmpdir/logic.out" 2>/dev/null)

Style Review:
$(cat "$tmpdir/style.out" 2>/dev/null)"

  echo -e "  ${AMBER}◉${NC} synthesizer: ${DIM}combining reviews...${NC}"

  local synthesis=$(cd "$WORKDIR" && claude -p "You are a code review synthesizer. Combine these three reviews into a single prioritized summary. Group by severity (Critical, Warning, Info). Remove duplicates. Be concise.

$all_reviews" ${MODEL:+--model "$MODEL"} 2>/dev/null)

  echo -e "  ${GREEN}✓${NC} synthesizer: done"
  echo ""
  echo -e "  ${BOLD}═══ Code Review Summary ═══${NC}"
  echo ""
  echo "$synthesis"
  echo ""

  rm -rf "$tmpdir"
}

# Main dispatch
case "$MODE" in
  single)
    if [[ ${#TASKS[@]} -eq 0 ]]; then
      print_help
      exit 1
    fi
    print_header
    run_single "${TASKS[0]}"
    ;;
  parallel)
    if [[ ${#TASKS[@]} -lt 2 ]]; then
      echo "Error: --parallel requires at least 2 tasks"
      exit 1
    fi
    run_parallel
    ;;
  sequential)
    if [[ ${#TASKS[@]} -lt 2 ]]; then
      echo "Error: --sequential requires at least 2 tasks"
      exit 1
    fi
    run_sequential
    ;;
  review)
    run_review
    ;;
esac

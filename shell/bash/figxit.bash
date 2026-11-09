[[ $- == *i* ]] || return 0

figxit() {
  if [[ -n $FIGXIT_APP ]]; then
    "$FIGXIT_APP/Contents/MacOS/figxit-engine" "$@"
  elif [[ -f $FIGXIT_HOME/engine/src/main.ts ]] && type -P bun >/dev/null; then
    bun run "$FIGXIT_HOME/engine/src/main.ts" "$@"
  else
    "$FIGXIT_HOME/dist/Figxit.app/Contents/MacOS/figxit-engine" "$@"
  fi
}

[[ -z ${_figxit_sep-} ]] || return 0
FIGXIT_HOME=${FIGXIT_HOME:-$(cd "${BASH_SOURCE[0]%/*}/../.." 2>/dev/null && pwd -P)}
if (( BASH_VERSINFO[0] < 5 )); then
  echo "figxit: bash 5 or later is needed, this shell is bash $BASH_VERSION" >&2
  return 0
fi

_figxit_sep=$'\x1f'
_figxit_out= _figxit_in= _figxit_pid= _figxit_last= _figxit_cell= _figxit_pushed=
_figxit_bound= _figxit_visible=0 _figxit_retry=0 _figxit_trap=1 _figxit_recall=0
_figxit_run=()
declare -A _figxit_pass _figxit_route _figxit_keymap

for _figxit_module in connect cursor keys bind hooks; do
  source "${BASH_SOURCE[0]%/*}/$_figxit_module.bash"
done
unset _figxit_module

if [[ ${PROMPT_COMMAND@a} == *a* ]]; then
  PROMPT_COMMAND+=(_figxit_prompt)
else
  PROMPT_COMMAND=${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}_figxit_prompt
fi

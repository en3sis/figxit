[[ -o interactive ]] || return 0

figxit() {
  if [[ -n $FIGXIT_APP ]]; then
    "$FIGXIT_APP/Contents/MacOS/figxit-engine" "$@"
  elif [[ -f $FIGXIT_HOME/engine/src/main.ts ]] && (( $+commands[bun] )); then
    bun run "$FIGXIT_HOME/engine/src/main.ts" "$@"
  else
    "$FIGXIT_HOME/dist/Figxit.app/Contents/MacOS/figxit-engine" "$@"
  fi
}

zmodload zsh/net/socket zsh/datetime 2>/dev/null || return 0
autoload -Uz add-zle-hook-widget add-zsh-hook

typeset -g FIGXIT_HOME=${FIGXIT_HOME:-${${(%):-%x}:A:h:h:h}}
typeset -g _figxit_sock=${FIGXIT_SOCK:-$HOME/.local/state/figxit/engine.sock}
typeset -g _figxit_sep=$'\x1f'
(( $+functions[_figxit_close] )) && _figxit_close
typeset -g _figxit_fd=
typeset -g _figxit_last= _figxit_size= _figxit_cell= _figxit_asked= _figxit_typed=
typeset -gF _figxit_asked_at=0 _figxit_wait=1
typeset -gi _figxit_visible=0 _figxit_retry=0 _figxit_depth=0 _figxit_reports=1 _figxit_timed=0 _figxit_seen=0 _figxit_ends=0
typeset -gA _figxit_orig _figxit_base
typeset -gA _figxit_keys=(
  '"^I"' figxit-tab
  '"^M"' figxit-enter
  '"^[[A"' figxit-up
  '"^[OA"' figxit-up
  '"^[[B"' figxit-down
  '"^[OB"' figxit-down
  '"^[^["' figxit-esc-esc
)

() {
  local module
  for module in connect cursor keys bind hooks; do
    source $1/$module.zsh
  done
} ${${(%):-%x}:A:h}

zle -N _figxit_recv
zle -N figxit-tab
zle -N figxit-report
zle -N figxit-report-end
zle -N figxit-enter
zle -N figxit-up
zle -N figxit-down
zle -N figxit-esc
zle -N figxit-esc-esc
_figxit_hook line-init _figxit_line_init
_figxit_hook line-pre-redraw _figxit_redraw
add-zsh-hook preexec _figxit_preexec
add-zsh-hook precmd _figxit_precmd

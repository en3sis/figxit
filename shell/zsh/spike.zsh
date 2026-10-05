#!/bin/zsh
zmodload zsh/net/socket

sock=${FIGXIT_HELPER_SOCK:-$HOME/.local/state/figxit/helper.sock}
hold=${FIGXIT_SPIKE_HOLD:-8}

for _ in {1..40}; do
  [[ -S $sock ]] && break
  sleep 0.1
done
[[ -S $sock ]] || { print -u2 "helper socket not found: $sock"; exit 1 }

request() {
  local fd line
  zsocket $sock || return 1
  fd=$REPLY
  print -r -u $fd -- "$1"
  read -r -t 3 -u $fd line
  exec {fd}>&-
  print -r -- $line
}

query_tty() {
  local reply saved
  saved=$(stty -g < /dev/tty)
  stty raw -echo min 0 time 10 < /dev/tty
  print -n -- $1 > /dev/tty
  read -r -d $2 reply < /dev/tty
  stty $saved < /dev/tty
  print -r -- ${reply#*\[}
}

probe=$(request '{"cmd":"probe"}')
print -r -- "probe: $probe"

padx=0
pady=0
if [[ $probe == *com.mitchellh.ghostty* ]]; then
  pady=2
  cfg=$(/Applications/Ghostty.app/Contents/MacOS/ghostty +show-config 2>/dev/null)
  for line in ${(f)cfg}; do
    case $line in
      "window-padding-x = "*) padx=${${line##* = }%%,*} ;;
      "window-padding-y = "*) pady=${${line##* = }%%,*} ;;
    esac
  done
fi

print
print "The popup must open with its top-left corner directly below the cursor."
print -n -- "> make "

cpw=""
cph=""
if [[ -n $TMUX ]]; then
  t=(${(s: :)"$(tmux display -p '#{pane_left} #{pane_top} #{cursor_x} #{cursor_y} #{client_width} #{client_height} #{client_cell_width} #{client_cell_height} #{status} #{status-position}')"})
  col=$(( t[1] + t[3] ))
  row=$(( t[2] + t[4] ))
  cols=$t[5]
  rows=$t[6]
  cpw=$t[7]
  cph=$t[8]
  if [[ $t[10] == top ]]; then
    case $t[9] in
      off) ;;
      on) (( row += 1 )) ;;
      *) (( row += t[9] )) ;;
    esac
  fi
  source_name="tmux ${(j: :)t}"
else
  pos=$(query_tty $'\e[6n' R)
  row=$(( ${pos%;*} - 1 ))
  col=$(( ${pos#*;} - 1 ))
  cols=$COLUMNS
  rows=$LINES
  cell=(${(s:;:)"$(query_tty $'\e[16t' t)"})
  if [[ $cell[1] == 6 ]]; then
    cph=$cell[2]
    cpw=$cell[3]
  fi
  source_name="tty pos=$pos cell=${(j:;:)cell}"
fi

grid="\"cols\":$cols,\"rows\":$rows,\"col\":$col,\"row\":$row,\"padX\":$padx,\"padY\":$pady"
if [[ -n $cpw && $cpw != 0 && -n $cph && $cph != 0 ]]; then
  grid+=",\"cellPxW\":$cpw,\"cellPxH\":$cph"
fi
items='[{"label":"dev","detail":"make target"},{"label":"build","detail":"make target"},{"label":"down","detail":"make target"}]'

reply=$(request "{\"cmd\":\"show\",\"grid\":{$grid},\"items\":$items,\"selected\":0}")
sleep $hold
request '{"cmd":"hide"}' > /dev/null

print
print
print -r -- "source: $source_name"
print -r -- "grid: {$grid}"
print -r -- "show: $reply"

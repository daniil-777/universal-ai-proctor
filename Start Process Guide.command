#!/bin/zsh
cd -- "$(dirname -- "$0")"
if command -v fnm >/dev/null 2>&1; then
  fnm exec --using=24.18.0 npm start
else
  npm start
fi

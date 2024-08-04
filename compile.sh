#!/bin/bash

SRC_DIR="src/rust"
DEST_DIR="../../../lib"

# Install cross if not already installed
if ! command -v cross &> /dev/null; then
    cargo install cross
fi

cd "$SRC_DIR" || exit

for dir in */; do
    if [ -d "$dir" ]; then
        cd "$dir" || exit
        
        # Compile for Linux
        cross build --release --target x86_64-unknown-linux-gnu
        mv target/x86_64-unknown-linux-gnu/release/*.so "$DEST_DIR/$(ls target/x86_64-unknown-linux-gnu/release/*.so | head -n 1 | xargs basename | sed 's/lib//')"

        # Compile for Windows
        cross build --release --target x86_64-pc-windows-gnu
        mv target/x86_64-pc-windows-gnu/release/*.dll "$DEST_DIR/$(ls target/x86_64-pc-windows-gnu/release/*.dll | head -n 1 | xargs basename | sed 's/lib//')"

        # no compile for MacOS, as it is not supported by cross (or I couldn't find out how to do it lol)

        cd ..
    fi
done

echo "All projects compiled and .so, .dll files moved to $DEST_DIR"

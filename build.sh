#!/bin/bash

#
# AniVault Build Script
# Automated build for web and Android
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Functions
print_header() {
    echo -e "${GREEN}===================================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}===================================================${NC}"
}

print_step() {
    echo -e "${YELLOW}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        print_error "$1 not found. Please install it first."
        return 1
    fi
    return 0
}

# Main menu
show_menu() {
    echo ""
    echo "AniVault Build System"
    echo "====================="
    echo "1) Web development (Start local server)"
    echo "2) Android Debug APK"
    echo "3) Android Release APK"
    echo "4) Sync Capacitor only"
    echo "5) Check environment"
    echo "6) Clean build cache"
    echo "7) Exit"
    echo ""
    read -p "Select option: " choice
}

# Build functions
build_web_dev() {
    print_header "Starting Web Development Server"
    
    check_command "python3" || check_command "python" || {
        print_error "Python not found"
        return 1
    }
    
    print_step "Starting HTTP server on port 8000..."
    cd "$PROJECT_DIR/src"
    python3 -m http.server 8000 2>/dev/null || python -m http.server 8000
}

build_android_debug() {
    print_header "Building Android Debug APK"
    
    check_command "node" || return 1
    check_command "java" || return 1
    
    print_step "Checking Android SDK..."
    if [ -z "$ANDROID_HOME" ]; then
        print_error "ANDROID_HOME not set"
        echo "Set it with: export ANDROID_HOME=/path/to/android-sdk"
        return 1
    fi
    
    print_step "Installing npm dependencies..."
    cd "$PROJECT_DIR"
    npm install --quiet
    
    print_step "Syncing Capacitor..."
    npx cap sync --quiet
    
    print_step "Building APK..."
    cd "$PROJECT_DIR/android"
    ./gradlew assembleDebug
    
    APK_PATH="$PROJECT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_PATH" ]; then
        print_success "APK built successfully!"
        echo "Location: $APK_PATH"
        echo ""
        echo "To install on device:"
        echo "  adb install $APK_PATH"
    else
        print_error "APK build failed"
        return 1
    fi
}

build_android_release() {
    print_header "Building Android Release APK"
    
    check_command "node" || return 1
    check_command "java" || return 1
    
    print_step "Checking Android SDK..."
    if [ -z "$ANDROID_HOME" ]; then
        print_error "ANDROID_HOME not set"
        echo "Set it with: export ANDROID_HOME=/path/to/android-sdk"
        return 1
    fi
    
    print_step "Installing npm dependencies..."
    cd "$PROJECT_DIR"
    npm install --quiet
    
    print_step "Syncing Capacitor..."
    npx cap sync --quiet
    
    print_step "Building APK..."
    cd "$PROJECT_DIR/android"
    ./gradlew assembleRelease
    
    APK_PATH="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"
    if [ -f "$APK_PATH" ]; then
        print_success "APK built successfully!"
        echo "Location: $APK_PATH"
        echo ""
        echo "Note: This APK is unsigned and for testing only."
        echo "For Play Store distribution, sign with your key."
    else
        print_error "APK build failed"
        return 1
    fi
}

sync_capacitor() {
    print_header "Syncing Capacitor"
    
    check_command "node" || return 1
    
    print_step "Installing npm dependencies..."
    cd "$PROJECT_DIR"
    npm install --quiet
    
    print_step "Syncing Capacitor..."
    npx cap sync
    
    print_success "Capacitor synced successfully"
}

check_environment() {
    print_header "Environment Check"
    
    echo ""
    echo "Checking required tools..."
    echo ""
    
    # Node
    if check_command "node"; then
        VERSION=$(node --version)
        print_success "Node.js: $VERSION"
    else
        print_error "Node.js not found"
    fi
    
    # NPM
    if check_command "npm"; then
        VERSION=$(npm --version)
        print_success "npm: $VERSION"
    else
        print_error "npm not found"
    fi
    
    # Java
    if check_command "java"; then
        VERSION=$(java -version 2>&1 | grep "openjdk\|java" | head -1)
        print_success "Java: $VERSION"
    else
        print_error "Java not found"
    fi
    
    # Python
    if check_command "python3"; then
        VERSION=$(python3 --version)
        print_success "Python: $VERSION"
    else
        print_error "Python not found"
    fi
    
    # Android SDK
    echo ""
    if [ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME" ]; then
        print_success "Android SDK: $ANDROID_HOME"
        
        if [ -d "$ANDROID_HOME/platforms" ]; then
            echo "  Available platforms:"
            ls "$ANDROID_HOME/platforms" 2>/dev/null | grep "^android-" | sed 's/^/    /'
        fi
    else
        print_error "Android SDK not configured (ANDROID_HOME not set)"
        echo "  Set with: export ANDROID_HOME=/path/to/android-sdk"
    fi
    
    echo ""
    echo "✓ Environment check complete"
}

clean_build() {
    print_header "Cleaning Build Cache"
    
    print_step "Cleaning Android build..."
    cd "$PROJECT_DIR/android"
    ./gradlew clean
    
    print_step "Cleaning npm cache..."
    cd "$PROJECT_DIR"
    npm cache clean --force 2>/dev/null || true
    
    print_success "Build cache cleaned"
}

# Main loop
main() {
    while true; do
        show_menu
        
        case $choice in
            1) build_web_dev ;;
            2) build_android_debug ;;
            3) build_android_release ;;
            4) sync_capacitor ;;
            5) check_environment ;;
            6) clean_build ;;
            7) 
                print_success "Goodbye!"
                exit 0
                ;;
            *)
                print_error "Invalid option"
                ;;
        esac
        
        if [ $? -ne 0 ]; then
            print_error "Operation failed"
        fi
        
        echo ""
        read -p "Press Enter to continue..."
    done
}

# Parse command line arguments
if [ $# -gt 0 ]; then
    case "$1" in
        web)
            build_web_dev
            ;;
        android-debug)
            build_android_debug
            ;;
        android-release)
            build_android_release
            ;;
        sync)
            sync_capacitor
            ;;
        check)
            check_environment
            ;;
        clean)
            clean_build
            ;;
        *)
            echo "Usage: $0 [web|android-debug|android-release|sync|check|clean]"
            echo ""
            echo "Or run without arguments for interactive menu:"
            echo "  $0"
            exit 1
            ;;
    esac
else
    main
fi

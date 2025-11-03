# Using nvm (Node Version Manager)

## Quick Reference

### Switch Node.js Version
```bash
# Switch to a specific version (temporary - only for current terminal)
nvm use 20.11.0

# List all installed versions
nvm list

# Switch to latest LTS version
nvm use --lts

# Switch to latest stable version
nvm use node
```

### Set Default Version
```bash
# Set default version (applies to new terminal windows)
nvm alias default 20.11.0

# Or use latest LTS as default
nvm alias default lts/*
```

### Install New Versions
```bash
# Install latest LTS version
nvm install --lts

# Install specific version
nvm install 20.11.0

# Install latest stable version
nvm install node
```

### Check Current Version
```bash
node --version
nvm current
```

### Auto-Switch Based on .nvmrc File
You can create a `.nvmrc` file in your project root with the version number:
```bash
echo "20.11.0" > .nvmrc
```

Then nvm will automatically switch when you `cd` into the directory (if you have auto-switching enabled):
```bash
nvm use  # Automatically reads .nvmrc
```

## Your Current Setup

Based on your installation, you have:
- **Currently Active**: v20.11.0 ✅ (Works with Wrangler)
- **Other Available Versions**: v18.20.8, v20.10.0, v24.11.0, v25.1.0
- **Old Version**: v12.18.4 (doesn't work with newer Wrangler)

## Recommended Configuration

For this project, we recommend using Node.js v20.11.0 (or any v20+):
```bash
nvm use 20.11.0
nvm alias default 20.11.0
```

## Common Issues

### Version Not Persisting Across Terminal Sessions
If you find yourself back on v12.18.4 when opening a new terminal:
```bash
# Set the default
nvm alias default 20.11.0

# Or add to your shell profile (~/.zshrc for zsh, ~/.bashrc for bash)
echo 'nvm use 20.11.0' >> ~/.zshrc
```

### "Command not found: nvm"
If nvm isn't available in a new terminal, you may need to add it to your shell profile. nvm usually adds this automatically during installation, but you can check:
```bash
# For zsh (which you're using)
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.zshrc
source ~/.zshrc
```

## Now You Can Use Wrangler

With Node.js v20.11.0 active, you can now run:
```bash
npx wrangler secret put ADMIN_PASSWORD_HASH
```

Make sure you're in the project directory when running this!


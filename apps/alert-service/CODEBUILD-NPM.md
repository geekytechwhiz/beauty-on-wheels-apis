# CodeBuild: GitHub Packages npm auth

See [docs/ci/github-packages-npm.md](../../docs/ci/github-packages-npm.md) for secret creation, IAM, buildspec wiring, and verification.

`@myvitalrx/mvrx-resource-registry` is published to GitHub Packages. CodeBuild must inject `NPM_TOKEN` so root `.npmrc` can authenticate.

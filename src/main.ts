import { readFileSync } from "fs";
import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const octokit = new Octokit({ auth: GITHUB_TOKEN });

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
}

async function getPRDetails(): Promise<PRDetails> {
  const { repository, number } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
  );
  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  };
}

async function getDiff(owner: string, repo: string, pull_number: number): Promise<string> {
  console.log(`Getting diff for PR #${pull_number}`);
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    headers: {
      accept: 'application/vnd.github.v3.diff'
    }
  });
  
  return response.data as unknown as string;
}

interface FileValidator {
  extensions: string[];
  patterns: string[];
  validate: (content: string) => string[];
}

const PACKAGE_VALIDATORS: Record<string, FileValidator> = {
  node: {
    extensions: ['package.json'],
    patterns: ['package.json'],
    validate: validateNodePackage
  },
  python: {
    extensions: ['.txt', '.pip'],
    patterns: ['requirements.txt', 'requirements/*.txt', 'requirements/**.txt'],
    validate: validatePythonPackage
  },
  ruby: {
    extensions: ['.gemfile', '.gemspec'],
    patterns: ['Gemfile', 'Gemfile.lock'],
    validate: validateRubyPackage
  },
  java: {
    extensions: ['.gradle', '.pom'],
    patterns: ['build.gradle', 'pom.xml'],
    validate: validateJavaPackage
  }
};

const CONTAINER_VALIDATORS: Record<string, FileValidator> = {
  docker: {
    extensions: ['Dockerfile'],
    patterns: ['Dockerfile', '**/Dockerfile', 'docker/Dockerfile'],
    validate: validateDockerfile
  },
  kubernetes: {
    extensions: ['.yaml', '.yml'],
    patterns: ['k8s/*.y{a,}ml', 'kubernetes/*.y{a,}ml'],
    validate: validateKubernetesManifest
  },
  compose: {
    extensions: ['.yaml', '.yml'],
    patterns: ['docker-compose.y{a,}ml'],
    validate: validateDockerCompose
  }
};

function validateNodePackage(content: string): string[] {
  const issues: string[] = [];
  const packageRegex = /"([^"]+)":\s*"([^"]+)"/g;
  const matches = [...content.matchAll(packageRegex)];
  
  for (const match of matches) {
    const [_, packageName, version] = match;
    if (version.startsWith("^") || version.startsWith("~") || version === "*") {
      issues.push(`⚠️ Package \`${packageName}\` should use exact version instead of \`${version}\`. Use exact version pinning for reproducible builds.`);
    }
  }
  return issues;
}

function validatePythonPackage(content: string): string[] {
  const issues: string[] = [];
  const requirementRegex = /^([^=><~\s]+)\s*((?:[<>=~]{1,2}|\^)?\s*[0-9][^;\s]*)?/gm;
  
  const matches = [...content.matchAll(requirementRegex)];
  for (const match of matches) {
    const [_, packageName, version] = match;
    if (!version || version.includes('~=') || version.includes('>') || version.includes('<')) {
      issues.push(`⚠️ Python package \`${packageName}\` should use exact version (==) instead of \`${version || 'unspecified'}\`.`);
    }
  }
  return issues;
}

function validateRubyPackage(content: string): string[] {
  const issues: string[] = [];
  const gemRegex = /gem\s+['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
  
  const matches = [...content.matchAll(gemRegex)];
  for (const match of matches) {
    const [_, gemName, version] = match;
    if (version.includes('~>') || version.includes('>') || version.includes('<')) {
      issues.push(`⚠️ Ruby gem \`${gemName}\` should use exact version instead of \`${version}\`.`);
    }
  }
  return issues;
}

function validateJavaPackage(content: string): string[] {
  const issues: string[] = [];
  // Gradle
  const gradleRegex = /([^:]+):([^:]+):([^'\s]+)/g;
  // Maven
  const mavenRegex = /<version>([^<]+)<\/version>/g;
  
  const gradleMatches = [...content.matchAll(gradleRegex)];
  const mavenMatches = [...content.matchAll(mavenRegex)];
  
  for (const match of gradleMatches) {
    const [_, group, artifact, version] = match;
    if (version.includes('+') || version.endsWith('.+') || version.includes('latest')) {
      issues.push(`⚠️ Gradle dependency \`${group}:${artifact}\` should use exact version instead of \`${version}\`.`);
    }
  }
  
  for (const match of mavenMatches) {
    const [_, version] = match;
    if (version.includes('SNAPSHOT') || version.includes('RELEASE') || version.includes('LATEST')) {
      issues.push(`⚠️ Maven dependency should use exact version instead of \`${version}\`.`);
    }
  }
  return issues;
}

function validateKubernetesManifest(content: string): string[] {
  const issues: string[] = [];
  const imageRegex = /image:\s*([^:\s]+)(?::([^\s]+))?/g;
  
  const matches = [...content.matchAll(imageRegex)];
  for (const match of matches) {
    const [_, image, tag] = match;
    if (!tag || tag === 'latest' || /^\d+$/.test(tag) || /^\d+\.\d+$/.test(tag)) {
      issues.push(`⚠️ Kubernetes container \`${image}\` should use specific version tag instead of \`${tag || 'latest'}\`.`);
    }
  }
  return issues;
}

function validateDockerCompose(content: string): string[] {
  const issues: string[] = [];
  const imageRegex = /image:\s*['"]?([^:\s'"]+)(?::([^\s'"]+))?['"]?/g;
  
  const matches = [...content.matchAll(imageRegex)];
  for (const match of matches) {
    const [_, image, tag] = match;
    if (!tag || tag === 'latest' || /^\d+$/.test(tag) || /^\d+\.\d+$/.test(tag)) {
      issues.push(`⚠️ Docker Compose service \`${image}\` should use specific version tag instead of \`${tag || 'latest'}\`.`);
    }
  }
  return issues;
}

function validateDockerfile(content: string): string[] {
  console.log('Validating Dockerfile content:', content);
  const issues: string[] = [];
  
  const cleanContent = content.split('\n')
    .map(line => line.replace(/^\+/, ''))
    .join('\n');
    
  console.log('Cleaned content:', cleanContent);

  const fromLines = cleanContent.match(/^FROM\s+[^\n]+/gm) || [];
  console.log('Found FROM lines:', fromLines);

  for (const fromLine of fromLines) {
    const match = fromLine.match(/FROM\s+([^:\s]+)(?::([^\s]+))?/);
    if (!match) continue;

    const [_, image, tag] = match;
    console.log(`Analyzing image: ${image}, tag: ${tag}`);

    if (!tag) {
      issues.push(`⚠️ Docker image \`${image}\` has no version tag specified. Use specific version tags for reproducible builds.`);
    } else if (
      tag === 'latest' ||
      tag === 'stable' ||
      tag === 'rolling' ||
      tag === 'alpine' ||
      /^\d+$/.test(tag) ||
      /^\d+\.\d+$/.test(tag) ||
      /^[a-zA-Z]+$/.test(tag) 
    ) {
      issues.push(`⚠️ Docker image \`${image}:${tag}\` uses non-specific tag. Use complete version numbers (e.g., '20.5.0-alpine3.18').`);
    }
  }

  console.log(`Found ${issues.length} issues in Dockerfile`);
  return issues;
}

function validateGitHubActions(diff: string): string[] {
  const issues: string[] = [];
  const actionRegex = /uses:\s+([^@]+)@([^\s]+)/g;
  const matches = [...diff.matchAll(actionRegex)];
  
  for (const match of matches) {
    const [_, action, version] = match;
    if (version === 'main' || version === 'master' || !version.match(/^v\d+\.\d+\.\d+$/)) {
      issues.push(`⚠️ GitHub Action \`${action}\` should use exact version (e.g., v1.2.3) instead of \`${version}\`. Use specific versions for reproducible workflows.`);
    }
  }
  return issues;
}

function validateDatabaseMigration(content: string): string[] {
  const issues: string[] = [];
  
  const cleanContent = content.split('\n')
    .map(line => line.replace(/^\+/, ''))
    .join('\n');
  
  const hasProperWrapper = /DO\s*\$\$\s*BEGIN[\s\S]*END\s*\$\$/i.test(cleanContent);
  
  if (!hasProperWrapper) {
    issues.push("⚠️ Migration should be wrapped in `DO $$ BEGIN ... END $$` block");
  } else {
    const blockContent = cleanContent.match(/BEGIN([\s\S]*?)END/i)?.[1] || '';
    
    const riskyPatterns = [
      {
        pattern: /CREATE\s+TABLE\s+(?!.*?IF\s+NOT\s+EXISTS)(\w+)/i,
        message: "⚠️ Use `CREATE TABLE IF NOT EXISTS` for idempotent table creation"
      },
      {
        pattern: /ALTER\s+TABLE\s+(?!.*?IF\s+(?:NOT\s+)?EXISTS)(\w+)/i,
        message: "⚠️ Use `ALTER TABLE IF EXISTS` for idempotent table alterations"
      },
      {
        pattern: /INSERT\s+INTO\s+(?!.*?(?:WHERE|IF)\s+NOT\s+EXISTS)(\w+)/i,
        message: "⚠️ Consider adding `WHERE NOT EXISTS` check for idempotent data insertion"
      },
      {
        pattern: /DROP\s+TABLE\s+(?!.*?IF\s+EXISTS)(\w+)/i,
        message: "⚠️ Use `DROP TABLE IF EXISTS` for idempotent table removal"
      }
    ];

    for (const { pattern, message } of riskyPatterns) {
      if (pattern.test(blockContent)) {
        const hasIfCheck = /IF\s+(?:NOT\s+)?EXISTS/i.test(blockContent);
        if (!hasIfCheck) {
          issues.push(message);
        }
      }
    }
  }

  return issues;
}

async function analyzeCode(parsedDiff: File[]): Promise<string[]> {
  const issues: string[] = [];
  console.log(`Analyzing ${parsedDiff.length} files`);
  
  for (const file of parsedDiff) {
    if (!file.to || file.to === "/dev/null") continue;
    
    console.log(`Analyzing file: ${file.to}`);
    
    const diffContent = file.chunks
      .map(chunk => chunk.changes
        .filter(change => change.type === 'add' || change.type === 'normal')
        .map(change => change.content)
        .join('\n')
      )
      .join('\n');
    
    for (const validator of Object.values(PACKAGE_VALIDATORS)) {
      if (
        validator.extensions.some(ext => file.to!.endsWith(ext)) ||
        validator.patterns.some(pattern => pattern.match(file.to!))
      ) {
        issues.push(...validator.validate(diffContent));
      }
    }
    
    for (const validator of Object.values(CONTAINER_VALIDATORS)) {
      if (
        validator.extensions.some(ext => file.to!.endsWith(ext)) ||
        validator.patterns.some(pattern => pattern.match(file.to!))
      ) {
        issues.push(...validator.validate(diffContent));
      }
    }
    
    if (file.to.match(/\.(sql|migration)$/) || file.to.includes('migrations/')) {
      issues.push(...validateDatabaseMigration(diffContent));
    }
  }
  
  return issues;
}

async function createComment(owner: string, repo: string, pull_number: number, issues: string[]): Promise<void> {
  if (issues.length > 0) {
    const body = `## 🔍 Version Pinning and Migration Validation

${issues.join('\n\n')}

### 📝 Recommendations:
#### Version Pinning:
- Use specific version tags (e.g., \`node:20.5.0\`)
- Avoid generic tags like \`latest\`, \`alpine\`, or partial versions
- Good examples:
  - \`FROM node:20.5.0-alpine3.18\`
  - \`FROM python:3.11.5\`
  - \`FROM ubuntu:22.04\`

#### Database Migrations:
- Always use \`IF EXISTS\` or \`IF NOT EXISTS\` clauses
- Wrap changes in transaction blocks (BEGIN/END)
- Include guards against duplicate operations
- Example of good migration:
\`\`\`sql
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'email') 
    THEN 
        ALTER TABLE users ADD COLUMN email VARCHAR(255);
    END IF;
END $$;
\`\`\`
`;

    console.log('Creating comment with issues:', body);
    
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body,
    });
    
    core.setFailed("❌ Version pinning and migration validation failed. See PR comments for details.");
  } else {
    console.log('No issues found, skipping comment creation');
  }
}

export async function run(): Promise<void> {
  try {
    console.log('Starting PR validation');
    const prDetails = await getPRDetails();
    console.log('PR Details:', prDetails);
    
    const diff = await getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
    
    if (!diff) {
      console.log('No diff found');
      return;
    }

    const parsedDiff = parseDiff(diff);
    console.log(`Parsed ${parsedDiff.length} files from diff`);
    
    const issues = await analyzeCode(parsedDiff);
    console.log(`Found ${issues.length} total issues`);
    
    await createComment(prDetails.owner, prDetails.repo, prDetails.pull_number, issues);
    
  } catch (error) {
    console.log('Error occurred:', error);
    core.setFailed(`Action failed: ${error}`);
  }
}
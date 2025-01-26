import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import matter from 'gray-matter';

const prisma = new PrismaClient();

// Path utility functions
const getProblemsDir = () => path.join(process.cwd(), 'problems');
const getProblemPath = (slug: string) => path.join(getProblemsDir(), slug, 'problem.md');
const getTestsDir = (slug: string) => path.join(getProblemsDir(), slug, 'tests');

async function main() {
  const problemsDir = getProblemsDir();
  const problemSlugs = readdirSync(problemsDir);

  for (const slug of problemSlugs) {
    const problemPath = getProblemPath(slug);
    const testsDir = getTestsDir(slug);

    // Parse markdown content
    const fileContents = readFileSync(problemPath, 'utf8');
    const { data: frontmatter, content } = matter(fileContents);

    // Validate required fields
    const requiredFields = ['slug', 'title', 'difficulty', 'author'];
    const missingFields = requiredFields.filter(field => !frontmatter[field]);
    if (missingFields.length > 0) {
      throw new Error(`Problem ${slug} is missing required frontmatter: ${missingFields.join(', ')}`);
    }

    // Upsert problem in database (without mdPath)
    const problem = await prisma.problem.upsert({
      where: { slug },
      update: {
        title: frontmatter.title,
        description: content,
        difficulty: frontmatter.difficulty,
        author: frontmatter.author
      },
      create: {
        slug,
        title: frontmatter.title,
        description: content,
        difficulty: frontmatter.difficulty,
        author: frontmatter.author
      }
    });

    // Sync test cases if directory exists
    if (existsSync(testsDir)) {
      const testFiles = readdirSync(testsDir).filter(f =>
        f.endsWith('.json') &&
        !['setup.json', 'config.json'].includes(f.toLowerCase())
      );

      await prisma.testCase.deleteMany({ where: { problemId: problem.id } });

      for (const testFile of testFiles) {
        const testPath = path.join(testsDir, testFile);
        const testContent = JSON.parse(readFileSync(testPath, 'utf8'));
        const isHidden = testFile.toLowerCase().includes('hidden');

        await prisma.testCase.create({
          data: {
            input: testContent.input,
            expected: testContent.expected,
            isHidden,
            problem: { connect: { id: problem.id } }
          }
        });
      }
      console.log(`Synced problem: ${slug} with ${testFiles.length} test cases`);
    } else {
      console.log(`Synced problem: ${slug} (no test cases found)`);
    }
  }
}

main()
  .catch(e => {
    console.error('❌ Sync failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

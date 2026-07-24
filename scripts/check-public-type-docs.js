import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)

if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
}

const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
const program = ts.createProgram(config.fileNames, config.options)
const checker = program.getTypeChecker()
const publicDeclarations = new Set()

for (const target of Object.values(packageJson.exports)) {
  if (!target || typeof target !== 'object' || typeof target.types !== 'string') {
    continue
  }

  const sourcePath = path.resolve(root, target.types.replace(/^\.\/dist\//u, 'src/').replace(/\.d\.ts$/u, '.ts'))
  const sourceFile = program.getSourceFile(sourcePath)

  if (!sourceFile) {
    throw new Error(`public type source not found: ${path.relative(root, sourcePath)}`)
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)

  if (!moduleSymbol) {
    throw new Error(`public type module has no symbol: ${path.relative(root, sourcePath)}`)
  }

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = resolveAlias(exported)

    for (const declaration of symbol.declarations ?? []) {
      if (
        ts.isInterfaceDeclaration(declaration) ||
        ts.isTypeAliasDeclaration(declaration) ||
        ts.isClassDeclaration(declaration)
      ) {
        publicDeclarations.add(declaration)
      }
    }
  }
}

const failures = []

for (const declaration of publicDeclarations) {
  checkDocumentation(declaration, declaration.name?.text ?? 'default')
}

if (failures.length > 0) {
  console.error('Public type documentation is incomplete:')

  for (const failure of failures.toSorted()) {
    console.error(`- ${failure}`)
  }

  process.exit(1)
}

console.log(`public type documentation: ${publicDeclarations.size} declarations ok`)

/**
 * Resolves a chain of TypeScript alias symbols.
 * @param {ts.Symbol} symbol Symbol exposed by a package entry point.
 * @returns {ts.Symbol} Underlying declaration symbol.
 */
function resolveAlias(symbol) {
  let current = symbol

  const seen = new Set()

  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
    seen.add(current)
    current = checker.getAliasedSymbol(current)
  }

  return current
}

/**
 * Checks one public type declaration and its directly exposed members.
 * @param {ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration} declaration Public declaration.
 * @param {string} name Display name used in failures.
 */
function checkDocumentation(declaration, name) {
  requireDocumentation(declaration, name)

  if (ts.isInterfaceDeclaration(declaration)) {
    checkMembers(declaration.members, name)

    return
  }

  if (ts.isClassDeclaration(declaration)) {
    const publicMembers = declaration.members.filter(
      (member) =>
        !ts.isConstructorDeclaration(member) &&
        !hasModifier(member, ts.SyntaxKind.PrivateKeyword) &&
        !hasModifier(member, ts.SyntaxKind.ProtectedKeyword) &&
        !ts.isPrivateIdentifier(member.name)
    )

    checkMembers(publicMembers, name)

    return
  }

  checkNestedType(declaration.type, name)
}

/**
 * Checks documentation on interface, type-literal, or class members.
 * @param {ts.NodeArray<ts.TypeElement | ts.ClassElement> | readonly (ts.TypeElement | ts.ClassElement)[]} members Members to inspect.
 * @param {string} owner Owning declaration path.
 */
function checkMembers(members, owner) {
  for (const member of members) {
    const name = memberName(member)

    requireDocumentation(member, `${owner}.${name}`)

    if ('type' in member && member.type) {
      checkNestedType(member.type, `${owner}.${name}`)
    }
  }
}

/**
 * Recursively checks members declared inside unions and type literals.
 * @param {ts.TypeNode} node Type node to inspect.
 * @param {string} owner Owning declaration path.
 */
function checkNestedType(node, owner) {
  if (ts.isTypeLiteralNode(node)) {
    checkMembers(node.members, owner)

    return
  }

  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    for (const type of node.types) {
      checkNestedType(type, owner)
    }

    return
  }

  if (ts.isParenthesizedTypeNode(node)) {
    checkNestedType(node.type, owner)
  }
}

/**
 * Records a failure when a node has no JSDoc block.
 * @param {ts.Node} node Node requiring documentation.
 * @param {string} label Human-readable declaration path.
 */
function requireDocumentation(node, label) {
  if (ts.getJSDocCommentsAndTags(node).some((item) => ts.isJSDoc(item))) {
    return
  }

  const sourceFile = node.getSourceFile()
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))

  failures.push(`${path.relative(root, sourceFile.fileName)}:${position.line + 1} ${label}`)
}

/**
 * Returns a stable display name for a type or class member.
 * @param {ts.TypeElement | ts.ClassElement} member Member to name.
 * @returns {string} Display name.
 */
function memberName(member) {
  if (ts.isCallSignatureDeclaration(member)) {
    return '()'
  }

  if (ts.isConstructSignatureDeclaration(member)) {
    return 'new()'
  }

  if (ts.isIndexSignatureDeclaration(member)) {
    return '[]'
  }

  const name = member.name

  if (!name) {
    return ts.SyntaxKind[member.kind]
  }

  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  return name.getText()
}

/**
 * Tests whether a node carries a selected TypeScript modifier.
 * @param {ts.Node} node Node to inspect.
 * @param {ts.SyntaxKind} kind Modifier syntax kind.
 * @returns {boolean} Whether the modifier is present.
 */
function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false
}

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { SetupOptions } from '../core/setup-orchestrator.js';
import { AgentProductId } from '../types/integrations.js';

export async function promptInteractiveSetup(defaults: SetupOptions = {}): Promise<SetupOptions> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log(`\n=============================================================`);
    console.log(`   Agentic SDLC — Setup Interativo & Preferências de Uso     `);
    console.log(`=============================================================\n`);

    // 1. Process Engine
    console.log('1. Escolha o Process Engine para o fluxo de desenvolvimento:');
    console.log('   [1] Superpowers (Recomendado: TDD estrito RED -> GREEN -> REFACTOR)');
    console.log('   [2] ECC (Enterprise Claude Code / Antigravity patterns)');
    console.log('   [3] Native (Mínimo sem plugins)');
    const engineAns = (await rl.question('   Selecione [1-3] (padrão: 1): ')).trim();
    const processEngine = engineAns === '2' ? 'ecc' : engineAns === '3' ? 'native' : 'superpowers';

    // 2. Test Command
    console.log('\n2. Comando de execução de testes automatizados do projeto:');
    const defaultTestCmd = defaults.testCommand || 'npm test';
    const testAns = (await rl.question(`   Comando de teste (padrão: "${defaultTestCmd}"): `)).trim();
    const testCommand = testAns || defaultTestCmd;

    // 3. Execution Mode
    console.log('\n3. Modo de execução das tarefas pelo orquestrador:');
    console.log('   [1] Delegated (Recomendado: prompt packs em .agentic/execution/inbox/ para o agente)');
    console.log('   [2] Command (Executa binário/CLI externo diretamente)');
    const execAns = (await rl.question('   Selecione [1-2] (padrão: 1): ')).trim();
    const executionMode = execAns === '2' ? 'command' : 'delegated';

    // 4. Grill-Me Rigor
    console.log('\n4. Nível de rigor das perguntas arquiteturais do Grill-Me:');
    console.log('   [1] Adaptive (Recomendado: aplica defaults seguros com ADR em PROPOSED)');
    console.log('   [2] Strict (Bloqueia até respostas serem ratificadas no answers.json)');
    const grillAns = (await rl.question('   Selecione [1-2] (padrão: 1): ')).trim();
    const grillMode = grillAns === '2' ? 'strict' : 'adaptive';

    // 5. Skill Packs
    console.log('\n5. Skill Packs mapeados para as etapas do SDLC (TDD, Grill-Me, Spec, Review):');
    console.log('   [1] Matt Pocock Skills (Recomendado: 14 etapas mapeadas)');
    console.log('   [2] ECC Skills');
    console.log('   [3] Ambos (Matt Pocock + ECC)');
    const skillsAns = (await rl.question('   Selecione [1-3] (padrão: 1): ')).trim();
    const skills = skillsAns === '2' ? ['ecc'] : skillsAns === '3' ? ['mattpocock', 'ecc'] : ['mattpocock'];

    // 6. AI Products to wire
    console.log('\n6. IAs a serem configuradas com as regras do SDLC:');
    console.log('   [1] Todas (Claude Code, Antigravity, Gemini CLI, Codex, Cursor, etc.)');
    console.log('   [2] Seleção personalizada');
    const aiAns = (await rl.question('   Selecione [1-2] (padrão: 1): ')).trim();
    let products = defaults.products;
    if (aiAns === '2') {
      const customAi = (await rl.question('   Digite os IDs separados por vírgula (ex: claude,antigravity,cursor): ')).trim();
      if (customAi) {
        products = customAi.split(/[,;\s]+/).map((p) => p.trim().toLowerCase()) as AgentProductId[];
      }
    }

    console.log('\n>>> Preferências registradas. Aplicando configurações...');
    return {
      ...defaults,
      processEngine,
      testCommand,
      executionMode,
      grillMode,
      skills,
      products,
    };
  } finally {
    rl.close();
  }
}

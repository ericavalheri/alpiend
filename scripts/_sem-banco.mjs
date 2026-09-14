// Limpa DATABASE_URL antes de qualquer outro módulo carregar.
//
// scripts-check-payment-security.mjs confere um comportamento que só existe SEM banco
// configurado (findPendingVoompAcceptances tem que dizer "não suportado" em vez de inventar
// candidatos). lib/db.mjs lê a variável uma vez, na hora que o módulo carrega — então apagar
// no meio do teste não adianta: tem que ser antes. Como os imports de um módulo ES são
// avaliados na ordem em que aparecem, importar este arquivo primeiro garante isso.
//
// Sem ele, o teste passava na máquina de quem não tinha DATABASE_URL e falhava na de quem
// tinha, sem relação nenhuma com o código sob teste.
delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

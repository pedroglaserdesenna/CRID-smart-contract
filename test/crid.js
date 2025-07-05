const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CRID - Inscrição em Disciplinas", function () {
  let crid, owner, aluno;
  const materiaCod = "MAC101";

  beforeEach(async function () {
    [owner, aluno] = await ethers.getSigners();
    const CRID = await ethers.getContractFactory("CRID");
    crid = await CRID.connect(owner).deploy();
  });

  it("Administrador deve registrar aluno com sucesso", async function () {
    await crid.connect(owner).registrarAluno(aluno.address, "João", "Engenharia");
    const info = await crid.alunos(aluno.address);
    expect(info.nome).to.equal("João");
  });

  it("Administrador deve registrar matéria com sucesso", async function () {
    await crid.connect(owner).criarMateria(materiaCod, "Cálculo I", 4, 60);
    const materia = await crid.materias(materiaCod);
    expect(materia.nome).to.equal("Cálculo I");
    expect(materia.ativa).to.be.true;
  });

  it("Aluno deve conseguir solicitar inscrição", async function () {
    await crid.connect(owner).registrarAluno(aluno.address, "João", "Engenharia");
    await crid.connect(owner).criarMateria(materiaCod, "Cálculo I", 4, 60);
    await crid.connect(aluno).solicitarInscricao(materiaCod);

    const lista = await crid.getInscricoes(aluno.address);
    expect(lista.length).to.equal(1);
    expect(lista[0].codigoMateria).to.equal(materiaCod);
    expect(lista[0].status).to.equal(0); // Pendente
  });

  it("Administrador deve aceitar uma inscrição", async function () {
    await crid.connect(owner).registrarAluno(aluno.address, "João", "Engenharia");
    await crid.connect(owner).criarMateria(materiaCod, "Cálculo I", 4, 60);
    await crid.connect(aluno).solicitarInscricao(materiaCod);

    await crid.connect(owner).processarInscricao(aluno.address, materiaCod, true, "Tudo certo");

    const lista = await crid.getInscricoes(aluno.address);
    expect(lista[0].status).to.equal(1); // Aceita
    expect(lista[0].motivo).to.equal("Tudo certo");
  });

  it("Administrador deve rejeitar uma inscrição com motivo", async function () {
    await crid.connect(owner).registrarAluno(aluno.address, "João", "Engenharia");
    await crid.connect(owner).criarMateria(materiaCod, "Cálculo I", 4, 60);
    await crid.connect(aluno).solicitarInscricao(materiaCod);

    await crid.connect(owner).processarInscricao(aluno.address, materiaCod, false, "Sem pré-requisito");

    const lista = await crid.getInscricoes(aluno.address);
    expect(lista[0].status).to.equal(2); // Rejeitada
    expect(lista[0].motivo).to.equal("Sem pré-requisito");
  });
});
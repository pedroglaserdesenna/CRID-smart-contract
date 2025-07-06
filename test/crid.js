const { expect } = require("chai");
const { ethers } = require("hardhat");

// Remova qualquer linha de importação de 'anyValue' se você a adicionou anteriormente.
// Ex: // const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/test-utils");

describe("CRID Contract Document Verification", function () {
  let CRIDContractFactory;
  let cridContract;
  let owner; // Representa a Universidade/Administrador
  let aluno1;
  let verificador;
  let addrs; // Outras contas

  // Helper para gerar o hash da mensagem que será assinada
  // DEVE CORRESPONDER EXATAMENTE À LÓGICA DE `getMessageHashToSign` NO SEU CONTRATO SOLIDITY
  async function generateMessageHashOffChain(
    documentHash,
    nonce,
    contractAddress
  ) {
    const encoded = ethers.solidityPacked(
      ["bytes32", "uint256", "address"],
      [documentHash, nonce, contractAddress]
    );
    const hash = ethers.keccak256(encoded);
    return ethers.hashMessage(ethers.getBytes(hash));
  }

  beforeEach(async function () {
    [owner, aluno1, verificador, ...addrs] = await ethers.getSigners();
    CRIDContractFactory = await ethers.getContractFactory("CRID");
    cridContract = await CRIDContractFactory.deploy();

    // Registrar o aluno1 no sistema CRID para os testes de documento
    await cridContract
      .connect(owner)
      .registrarAluno(aluno1.address, "Marie Sklodowska-Curie", "Fisica");
  });

  describe("CRID Document Issuance and Verification", function () {
    it("Deve permitir que o administrador (Universidade) emita o hash de um documento CRID", async function () {
      const cridContent =
        "Confirmação de Registro de Inscrição em Disciplinas - Aluno: Marie Sklodowska-Curie - Matrícula: [endereco do aluno] - Disciplinas: Algoritmos, Quimica.";
      const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));

      await expect(
        cridContract
          .connect(owner)
          .issueCRIDConfirmation(documentHash, aluno1.address)
      )
        .to.emit(cridContract, "CRIDDocumentIssued")
        .withArgs(documentHash, aluno1.address, owner.address, (timestamp) => {
          // Função de callback para validar o timestamp
          // No Ethers v6 (usado com hardhat-toolbox ^6.0.0), BigNumbers são representados como BigInts nativos
          return typeof timestamp === "bigint" && timestamp > 0n;
        });

      const docInfo = await cridContract.registeredCRIDDocuments(documentHash);
      expect(docInfo.timestamp).to.not.equal(0);
      expect(docInfo.studentAddress).to.equal(aluno1.address);
      expect(docInfo.revoked).to.be.false;
    });

    it("Não deve permitir que não-administrador emita o hash de um documento CRID", async function () {
      const cridContent = "CRID Falso.";
      const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));

      await expect(
        cridContract
          .connect(aluno1)
          .issueCRIDConfirmation(documentHash, aluno1.address)
      ).to.be.revertedWith("Somente o administrador pode executar");
    });

    it("Não deve permitir emitir o mesmo hash de documento CRID duas vezes", async function () {
      const cridContent = "CRID Duplicado.";
      const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));

      await cridContract
        .connect(owner)
        .issueCRIDConfirmation(documentHash, aluno1.address);
      await expect(
        cridContract
          .connect(owner)
          .issueCRIDConfirmation(documentHash, aluno1.address)
      ).to.be.revertedWith("Documento CRID ja registrado.");
    });

    it("Deve verificar corretamente um documento CRID autêntico com assinatura", async function () {
      const cridContent =
        "CRID de Marie Sklodowska-Curie - Conteúdo completo do CRID oficial.";
      const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));
      const nonce = 1; // Um nonce único para esta emissão do documento CRID

      // 1. O administrador (Universidade) registra o hash do documento CRID on-chain
      await cridContract
        .connect(owner)
        .issueCRIDConfirmation(documentHash, aluno1.address);

      // 2. O administrador (Universidade) assina o hash do documento CRID off-chain
      // Geramos o hash que o Solidity espera para assinar (documentHash + nonce + address(this))
      const messageHashForSolidity = await cridContract.getMessageHashToSign(
        documentHash,
        nonce
      );
      // Depois, o ethers.js `signMessage` adiciona seu próprio prefixo a isso.
      const signature = await owner.signMessage(
        ethers.getBytes(messageHashForSolidity)
      );

      // 3. Um verificador tenta verificar o documento
      const [isAuthentic, signer, isRevoked] = await cridContract
        .connect(verificador)
        .verifyCRIDAuthenticity(documentHash, nonce, signature);
      expect(isAuthentic).to.be.true;
      expect(signer).to.equal(owner.address);
      expect(isRevoked).to.be.false;
    });

    it("Deve falhar na verificação se a assinatura for inválida (signatário incorreto)", async function () {
      const cridContent = "CRID com assinatura falsa.";
      const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));
      const nonce = 2;

      await cridContract
        .connect(owner)
        .issueCRIDConfirmation(documentHash, aluno1.address);

      // Assinar com uma conta diferente do owner (Universidade)
      const messageHashForSolidity = await cridContract.getMessageHashToSign(
        documentHash,
        nonce
      );
      const invalidSignature = await aluno1.signMessage(
        ethers.getBytes(messageHashForSolidity)
      ); // Aluno1 assina

      const [isAuthentic, signer, isRevoked] = await cridContract
        .connect(verificador)
        .verifyCRIDAuthenticity(documentHash, nonce, invalidSignature);
      expect(isAuthentic).to.be.false; // Deve retornar false
      expect(signer).to.not.equal(owner.address); // O signatário recuperado não é o owner
    });

    it("Deve falhar na verificação se o hash do documento não estiver registrado", async function () {
      const cridContent = "CRID não registrado.";
      const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));
      const nonce = 3;

      // Não registra o documento no contrato!
      const messageHashForSolidity = await cridContract.getMessageHashToSign(
        documentHash,
        nonce
      );
      const signature = await owner.signMessage(
        ethers.getBytes(messageHashForSolidity)
      );

      const [isAuthentic, signer, isRevoked] = await cridContract
        .connect(verificador)
        .verifyCRIDAuthenticity(documentHash, nonce, signature);
      expect(isAuthentic).to.be.false; // Deve retornar false porque o hash não está registrado
      expect(signer).to.equal(owner.address); // A assinatura é do owner, mas o documento não existe
    });

    it("Deve falhar na verificação se o nonce estiver incorreto", async function () {
      const cridContent = "CRID com nonce errado.";
      const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));
      const correctNonce = 4;
      const incorrectNonce = 5;

      await cridContract
        .connect(owner)
        .issueCRIDConfirmation(documentHash, aluno1.address);

      // Geração da assinatura com o nonce correto
      const messageHashForSolidity = await cridContract.getMessageHashToSign(
        documentHash,
        correctNonce
      );
      const signature = await owner.signMessage(
        ethers.getBytes(messageHashForSolidity)
      );

      // Tenta verificar com o nonce incorreto
      const [isAuthentic, signer, isRevoked] = await cridContract
        .connect(verificador)
        .verifyCRIDAuthenticity(
          documentHash,
          incorrectNonce, // Nonce incorreto aqui!
          signature
        );
      expect(isAuthentic).to.be.false; // Deve retornar false
    });

    describe("CRID Document Revocation (Opcional)", function () {
      it("Deve permitir que o administrador revogue um documento CRID registrado", async function () {
        const cridContent = "CRID para Revogação.";
        const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));
        const nonce = 6;

        await cridContract
          .connect(owner)
          .issueCRIDConfirmation(documentHash, aluno1.address);

        // Verificar antes da revogação
        const messageHashForSolidity = await cridContract.getMessageHashToSign(
          documentHash,
          nonce
        );
        const signature = await owner.signMessage(
          ethers.getBytes(messageHashForSolidity)
        );
        let [isAuthentic, ,] = await cridContract.verifyCRIDAuthenticity(
          documentHash,
          nonce,
          signature
        );
        expect(isAuthentic).to.be.true;

        // Revogar
        await expect(
          cridContract.connect(owner).revokeCRIDDocument(documentHash)
        )
          .to.emit(cridContract, "CRIDDocumentRevoked")
          .withArgs(documentHash, owner.address, (timestamp) => {
            // Função de callback para validar o timestamp
            return typeof timestamp === "bigint" && timestamp > 0n;
          });

        const docInfo = await cridContract.registeredCRIDDocuments(
          documentHash
        );
        expect(docInfo.revoked).to.be.true;

        // Verificar depois da revogação (deve falhar)
        [isAuthentic, ,] = await cridContract.verifyCRIDAuthenticity(
          documentHash,
          nonce,
          signature
        );
        expect(isAuthentic).to.be.false;
      });

      it("Não deve permitir que não-administrador revogue um documento CRID", async function () {
        const cridContent = "CRID de Revogação Ilegal.";
        const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));

        await cridContract
          .connect(owner)
          .issueCRIDConfirmation(documentHash, aluno1.address);

        await expect(
          cridContract.connect(aluno1).revokeCRIDDocument(documentHash)
        ).to.be.revertedWith("Somente o administrador pode executar");
      });

      it("Não deve permitir revogar um documento CRID não registrado", async function () {
        const documentHash = ethers.keccak256(
          ethers.toUtf8Bytes("Hash nao registrado para revogar.")
        );
        await expect(
          cridContract.connect(owner).revokeCRIDDocument(documentHash)
        ).to.be.revertedWith("Documento CRID nao registrado.");
      });

      it("Não deve permitir revogar um documento CRID já revogado", async function () {
        const cridContent = "CRID já revogado.";
        const documentHash = ethers.keccak256(ethers.toUtf8Bytes(cridContent));

        await cridContract
          .connect(owner)
          .issueCRIDConfirmation(documentHash, aluno1.address);
        await cridContract.connect(owner).revokeCRIDDocument(documentHash);

        await expect(
          cridContract.connect(owner).revokeCRIDDocument(documentHash)
        ).to.be.revertedWith("Documento CRID ja revogado.");
      });
    });
  });

  // Você pode manter seus testes existentes para as funcionalidades de `registrarAluno`,
  // `criarMateria`, `solicitarInscricao`, `processarInscricao`, `getInscricoes` aqui.
  describe("Existing CRID functionalities", function () {
    it("Should register a student correctly", async function () {
      // Already registered in beforeEach, verify its state
      const registeredStudent = await cridContract.alunos(aluno1.address);
      expect(registeredStudent.nome).to.equal("Marie Sklodowska-Curie");
      expect(registeredStudent.curso).to.equal("Fisica");
      expect(registeredStudent.existe).to.be.true;
    });

    it("Should allow student to request enrollment", async function () {
      await cridContract
        .connect(owner)
        .criarMateria("COMP101", "Introducao a Programacao", 4, 30);
      await expect(cridContract.connect(aluno1).solicitarInscricao("COMP101"))
        .to.emit(cridContract, "InscricaoSolicitada")
        .withArgs(aluno1.address, "COMP101");

      const inscricoesAluno = await cridContract.getInscricoes(aluno1.address);
      expect(inscricoesAluno.length).to.equal(1);
      expect(inscricoesAluno[0].codigoMateria).to.equal("COMP101");
      expect(inscricoesAluno[0].status).to.equal(0); // Pendente
    });

    it("Should allow admin to process enrollment", async function () {
      await cridContract
        .connect(owner)
        .criarMateria("COMP101", "Introducao a Programacao", 4, 1); // Capacidade 1 para teste
      await cridContract.connect(aluno1).solicitarInscricao("COMP101");

      await expect(
        cridContract
          .connect(owner)
          .processarInscricao(aluno1.address, "COMP101", true, "Aprovado")
      )
        .to.emit(cridContract, "InscricaoProcessada")
        .withArgs(aluno1.address, "COMP101", 1, "Aprovado"); // 1 é StatusInscricao.Aceita

      const inscricoesAluno = await cridContract.getInscricoes(aluno1.address);
      expect(inscricoesAluno[0].status).to.equal(1); // Aceita

      const materiaInfo = await cridContract.materias("COMP101");
      expect(materiaInfo.matriculados).to.equal(1);
      expect(materiaInfo.capacidade).to.equal(1);
    });

    it("Should prevent enrollment if capacity is full", async function () {
      await cridContract
        .connect(owner)
        .criarMateria("COMP101", "Introducao a Programacao", 4, 0); // Capacidade 0
      await expect(
        cridContract.connect(aluno1).solicitarInscricao("COMP101")
      ).to.be.revertedWith("Materia lotada");
    });
  });
});

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CRID {
    address public owner;

    // --- Funções Auxiliares de Assinatura (Adaptadas do ReceiverPays) ---
    // Funcao para separar a assinatura em r, s, v
    function splitSignature(bytes memory sig)
        internal
        pure
        returns (bytes32 r, bytes32 s, uint8 v)
    {
        require(sig.length == 65, "ECDSA: invalid signature length");

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        // Recuperacao de V para compatibilidade com ecrecover
        // v = 0 ou 1 significa EIP-155. O ecrecover espera 27 ou 28.
        if (v < 27) {
            v += 27;
        }
    }

    // Adiciona o prefixo Ethereum Signed Message para compatibilidade com eth_sign
    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    // Recupera o endereco do signatario
    function recoverSigner(bytes32 message, bytes memory sig)
        internal
        pure
        returns (address)
    {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(sig);
        return ecrecover(message, v, r, s);
    }

    // --- Novas Estruturas e Mapeamentos para o Cenário 3 (Verificação de Documentos CRID) ---

    struct CRIDDocumentInfo {
        uint timestamp;
        address studentAddress; // Endereço do aluno associado a este CRID
        bool revoked;          // Para funcionalidade de revogação (opcional)
    }

    // Mapeia o hash do documento CRID para suas informações
    mapping(bytes32 => CRIDDocumentInfo) public registeredCRIDDocuments;

    // --- Eventos Adicionais para o Cenário 3 ---
    event CRIDDocumentIssued(bytes32 indexed documentHash, address indexed studentAddress, address indexed issuer, uint timestamp);
    event CRIDDocumentVerified(bytes32 indexed documentHash, address indexed verifier, bool isAuthentic);
    event CRIDDocumentRevoked(bytes32 indexed documentHash, address indexed revoker, uint timestamp); // Se implementar revogação


    // --- CONSTRUTOR ---
    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Somente o administrador pode executar");
        _;
    }

    // --- ESTRUTURAS EXISTENTES ---
    struct Aluno {
        string nome;
        string curso;
        bool existe;
    }

    struct Materia {
        string nome;
        uint8 creditos;
        uint16 capacidade;
        uint16 matriculados; // Adicionar para controlar o número de alunos matriculados
        bool ativa;
    }

    enum StatusInscricao {
        Pendente,
        Aceita,
        Rejeitada
    }

    struct Inscricao {
        string codigoMateria;
        StatusInscricao status;
        string motivo; // motivo da aceitação/rejeição
    }

    // Matrícula do aluno -> dados do aluno (Alterado para address para mapear diretamente)
    mapping(address => Aluno) public alunos;

    // Código da matéria -> dados da matéria
    mapping(string => Materia) public materias;

    // Aluno -> lista de inscrições
    mapping(address => Inscricao[]) private inscricoes;

    // --- EVENTOS EXISTENTES ---
    event AlunoRegistrado(address aluno, string nome, string curso);
    event MateriaCriada(string codigo, string nome, uint8 creditos, uint16 capacidade);
    event InscricaoSolicitada(address aluno, string codigoMateria);
    event InscricaoProcessada(address aluno, string codigoMateria, StatusInscricao status, string motivo);

    // --- FUNÇÕES EXISTENTES ---

    // Registrar aluno - só admin
    function registrarAluno(address _aluno, string memory _nome, string memory _curso) public onlyOwner {
        require(!alunos[_aluno].existe, "Aluno ja registrado");
        alunos[_aluno] = Aluno(_nome, _curso, true);
        emit AlunoRegistrado(_aluno, _nome, _curso);
    }

    // Criar matéria - só admin
    function criarMateria(string memory _codigo, string memory _nome, uint8 _creditos, uint16 _capacidade) public onlyOwner {
        require(!materias[_codigo].ativa, "Materia ja existe");
        materias[_codigo] = Materia(_nome, _creditos, _capacidade, 0, true); // Inicializar matriculados como 0
        emit MateriaCriada(_codigo, _nome, _creditos, _capacidade);
    }

    // Aluno solicita inscrição
    function solicitarInscricao(string memory _codigoMateria) public {
        require(alunos[msg.sender].existe, "Aluno nao registrado");
        require(materias[_codigoMateria].ativa, "Materia nao existe ou inativa");
        require(materias[_codigoMateria].matriculados < materias[_codigoMateria].capacidade, "Materia lotada");

        // Verifica se já não tem inscrição pendente ou aceita nessa matéria
        Inscricao[] storage lista = inscricoes[msg.sender];
        for (uint i = 0; i < lista.length; i++) {
            if (keccak256(bytes(lista[i].codigoMateria)) == keccak256(bytes(_codigoMateria))) {
                require(lista[i].status == StatusInscricao.Rejeitada, "Inscricao ja existe e nao esta rejeitada");
            }
        }

        // Adiciona inscrição com status pendente
        inscricoes[msg.sender].push(Inscricao(_codigoMateria, StatusInscricao.Pendente, ""));
        emit InscricaoSolicitada(msg.sender, _codigoMateria);
    }

    // Admin processa inscrição: aprova ou rejeita com motivo
    function processarInscricao(address _aluno, string memory _codigoMateria, bool _aceitar, string memory _motivo) public onlyOwner {
        require(alunos[_aluno].existe, "Aluno nao registrado"); // Garante que o aluno existe
        require(materias[_codigoMateria].ativa, "Materia nao existe ou inativa"); // Garante que a materia existe

        Inscricao[] storage lista = inscricoes[_aluno];
        bool found = false;
        for (uint i = 0; i < lista.length; i++) {
            if (keccak256(bytes(lista[i].codigoMateria)) == keccak256(bytes(_codigoMateria))) {
                require(lista[i].status == StatusInscricao.Pendente, "Inscricao nao pendente"); // Só processa se for pendente

                if (_aceitar) {
                    require(materias[_codigoMateria].matriculados < materias[_codigoMateria].capacidade, "Materia lotada");
                    materias[_codigoMateria].matriculados++;
                    lista[i].status = StatusInscricao.Aceita;
                } else {
                    lista[i].status = StatusInscricao.Rejeitada;
                }
                lista[i].motivo = _motivo;
                found = true;
                emit InscricaoProcessada(_aluno, _codigoMateria, lista[i].status, _motivo);
                break;
            }
        }
        require(found, "Inscricao pendente nao encontrada para este aluno e materia");
    }

    // Consultar inscrições do aluno
    function getInscricoes(address _aluno) public view returns(Inscricao[] memory) {
        return inscricoes[_aluno];
    }

    // --- NOVAS FUNÇÕES PARA REGISTRO E VERIFICAÇÃO DE DOCUMENTOS CRID FINAIS ---

    // Gera o hash da mensagem que será assinada off-chain pela Universidade
    // Este hash inclui o hash do documento CRID, um nonce e o endereço do contrato
    // para prevenir replay attacks em diferentes contextos ou re-uso da assinatura.
    function getMessageHashToSign(bytes32 _documentHash, uint256 _nonce) public view returns (bytes32) {
        // A ordem e os elementos aqui devem coincidir com a forma como o JS vai gerar o hash para assinar.
        // Usamos abi.encodePacked para garantir a mesma codificação que será usada off-chain
        return keccak256(abi.encodePacked(_documentHash, _nonce, address(this)));
    }


    // Função para a Universidade registrar o hash de um documento CRID final
    // Chamada DEPOIS que o documento CRID é gerado off-chain.
    function issueCRIDConfirmation(bytes32 _documentHash, address _studentAddress) public onlyOwner {
        require(registeredCRIDDocuments[_documentHash].timestamp == 0, "Documento CRID ja registrado.");
        require(alunos[_studentAddress].existe, "Aluno associado ao CRID nao registrado no sistema.");

        registeredCRIDDocuments[_documentHash] = CRIDDocumentInfo({
            timestamp: block.timestamp,
            studentAddress: _studentAddress,
            revoked: false
        });
        emit CRIDDocumentIssued(_documentHash, _studentAddress, msg.sender, block.timestamp);
    }

    // Função para qualquer um verificar a autenticidade de um documento CRID
    // Requer o hash do documento, o nonce usado na assinatura, e a assinatura em si.
    function verifyCRIDAuthenticity(
        bytes32 _documentHash,
        uint256 _nonce,
        bytes memory _signature
    ) public view returns (bool, address, bool) { // Retorna (autentico, signatario, revogado)
        // 1. Reconstruir a mensagem que foi assinada (com o prefixo para eth_sign)
        bytes32 messageToVerify = prefixed(getMessageHashToSign(_documentHash, _nonce));

        // 2. Recuperar o endereço do signatário usando ecrecover
        address signer = recoverSigner(messageToVerify, _signature);

        // 3. Verificar se o signatário é o owner (Universidade)
        bool isOwnerSignature = (signer == owner);

        // 4. Verificar se o documento CRID foi registrado no contrato
        bool isRegistered = (registeredCRIDDocuments[_documentHash].timestamp != 0);

        // 5. Verificar se o documento não foi revogado (se a funcionalidade de revogação for usada)
        bool isRevoked = registeredCRIDDocuments[_documentHash].revoked;

        // Retorna a autenticidade geral e informações adicionais para debug/uso externo
        return (isOwnerSignature && isRegistered && !isRevoked, signer, isRevoked);
    }

    // Função opcional para revogar um documento CRID (somente o owner)
    function revokeCRIDDocument(bytes32 _documentHash) public onlyOwner {
        require(registeredCRIDDocuments[_documentHash].timestamp != 0, "Documento CRID nao registrado.");
        require(!registeredCRIDDocuments[_documentHash].revoked, "Documento CRID ja revogado.");

        registeredCRIDDocuments[_documentHash].revoked = true;
        emit CRIDDocumentRevoked(_documentHash, msg.sender, block.timestamp);
    }
}
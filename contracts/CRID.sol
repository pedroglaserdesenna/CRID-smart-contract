// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CRID
 * @dev Contrato para gerenciamento de inscrições em disciplinas,
 * seguindo as novas especificações.
 */
contract CRID {
    address public owner;

    struct Aluno {
        uint dre;
        string nome;
        string curso;
        bool existe;
    }

    struct Materia {
        string codigo;
        string nome;
        uint creditos;
        uint cargaHoraria;
        bool ativa;
        bool existe;
    }

    enum StatusInscricao {
        Pendente,
        Aprovada,
        Rejeitada
    }

    struct Inscricao {
        uint id;
        uint matriculaAluno;
        string codigoMateria;
        StatusInscricao status;
        string motivoRejeicao;
    }

    mapping(uint => Aluno) public alunos;
    mapping(string => Materia) public materias;
    Inscricao[] public solicitacoes;

    modifier onlyOwner() {
        require(
            msg.sender == owner,
            "Acao permitida apenas para a administracao"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function registrarAluno(
        uint _dre,
        string calldata _nome,
        string calldata _curso
    ) public onlyOwner {
        require(!alunos[_dre].existe, "Aluno com este dre ja existe");
        alunos[_dre] = Aluno(_dre, _nome, _curso, true);
    }

    function criarMateria(
        string calldata _codigo,
        string calldata _nome,
        uint _creditos,
        uint _cargaHoraria
    ) public onlyOwner {
        require(!materias[_codigo].existe, "Materia com este codigo ja existe");
        materias[_codigo] = Materia(
            _codigo,
            _nome,
            _creditos,
            _cargaHoraria,
            true,
            true
        );
    }

    function solicitarInscricao(
        uint _dre,
        string calldata _codigoMateria
    ) public {
        require(alunos[_dre].existe, "Aluno nao registrado");
        require(materias[_codigoMateria].existe, "Materia nao existe");
        require(materias[_codigoMateria].ativa, "Materia nao esta ativa");

        uint inscricaoId = solicitacoes.length;
        solicitacoes.push(
            Inscricao({
                id: inscricaoId,
                matriculaAluno: _dre,
                codigoMateria: _codigoMateria,
                status: StatusInscricao.Pendente,
                motivoRejeicao: ""
            })
        );
    }

    function aprovarInscricao(uint _inscricaoId) public onlyOwner {
        Inscricao storage inscricao = solicitacoes[_inscricaoId];
        require(
            inscricao.status == StatusInscricao.Pendente,
            "A inscricao nao esta pendente"
        );
        inscricao.status = StatusInscricao.Aprovada;
    }

    function rejeitarInscricao(
        uint _inscricaoId,
        string calldata _motivo
    ) public onlyOwner {
        Inscricao storage inscricao = solicitacoes[_inscricaoId];
        require(
            inscricao.status == StatusInscricao.Pendente,
            "A inscricao nao esta pendente"
        );

        inscricao.status = StatusInscricao.Rejeitada;
        inscricao.motivoRejeicao = _motivo;
    }
}

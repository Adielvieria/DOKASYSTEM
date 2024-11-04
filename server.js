const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const http = require('http');
const socketIo = require('socket.io');
const xss = require('xss');
const sanitize = require('mongo-sanitize'); // Para prevenir injeção no MongoDB
const Reserva = require('./models/Reserva');

// Configurações do transportador de email
const transporter = nodemailer.createTransport({
    host: 'smtp.dokapack.com.br',
    port: 465,
    secure: true,
    auth: {
        user: 'nao-responda@dokapack.com.br',
        pass: '$N3wP@55#Nao-Responda*', // *Idealmente, use variáveis de ambiente para guardar senhas
    },
    tls: {
        rejectUnauthorized: false
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// Criar o servidor HTTP e inicializar o socket.io
const server = http.createServer(app);
const io = socketIo(server);

// Conectar ao MongoDB
mongoose.connect('mongodb://localhost:27017/agendamento', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('Conectado ao MongoDB'))
    .catch(err => console.error('Erro ao conectar ao MongoDB:', err));

// Configurar Body-Parser
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Servir arquivos estáticos
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Função para enviar e-mail
const enviarEmail = async (options) => {
    try {
        await transporter.sendMail(options);
    } catch (error) {
        console.error('Erro ao enviar email:', error);
    }
};

// Rota Principal
app.get('/', (req, res) => {
    console.log('Rota principal acessada');
    res.render('index', { mensagem: null });
});

// Rota de reserva
app.post('/reservar', async (req, res) => {
    try {
        // Sanitizar os dados de entrada
        const nome = sanitize(xss(req.body.nome));
        const email = sanitize(xss(req.body.email));
        const dataInicio = sanitize(req.body.dataInicio);
        const dataFim = sanitize(req.body.dataFim);
        const horaInicio = sanitize(req.body.horaInicio);
        const horaFim = sanitize(req.body.horaFim);

        console.log("Dados recebidos:", req.body);
        
        // Verificando se o email tem um formato válido
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Email inválido.' });
        }

        // Convertendo para objetos Date para comparação
        const dataInicioCompleta = new Date(`${dataInicio}T${horaInicio}`);
        const dataFimCompleta = new Date(`${dataFim}T${horaFim}`);

        // Verificando se as datas são válidas
        if (isNaN(dataInicioCompleta.getTime()) || isNaN(dataFimCompleta.getTime())) {
            return res.status(400).json({ success: false, message: 'Data ou hora inválida.' });
        }

        // Verificar se já existe uma reserva para o mesmo horário (mais robusto)
        const reservaExistente = await Reserva.findOne({
            $and: [
                { dataFim: { $gt: dataInicioCompleta } }, // Verifica se a reserva existente termina depois do início da nova
                { dataInicio: { $lt: dataFimCompleta } }, // Verifica se a reserva existente começa antes do término da nova
                { status: { $ne: 'rejeitada' } } // Ignorar reservas rejeitadas
            ]
        });
        
        if (reservaExistente) {
            return res.status(409).json({ success: false, message: 'Esse horário já está reservado!' });
        }        

        if (reservaExistente) {
            return res.status(409).json({ success: false, message: 'Esse horário já está reservado!' });
        }

        // Se não houver conflito, salva a nova reserva
        const novaReserva = new Reserva({
            nome,
            email,
            dataInicio: dataInicioCompleta,
            dataFim: dataFimCompleta,
            horaInicio,
            horaFim,
            status: 'pendente' // Define o status inicial como pendente
        });

        const reservaSalva = await novaReserva.save();

        const mailOptions = {
            from: 'nao-responda@dokapack.com.br',
            to: 'tic@dokapack.com.br',
            subject: 'Nova Solicitação de Agendamento',
            text: `Uma nova solicitação de agendamento foi realizada:\n\nNome: ${nome}\nEmail: ${email}\nData de Início: ${dataInicio} ${horaInicio}\nData de Término: ${dataFim} ${horaFim}`,
        };

        await enviarEmail(mailOptions);

        io.emit('novaReserva', {
            _id: reservaSalva._id,
            nome: reservaSalva.nome,
            dataInicio: reservaSalva.dataInicio,
            dataFim: reservaSalva.dataFim,
            email: reservaSalva.email
        });

        return res.status(201).json({ success: true, message: 'Solicitação de reserva enviada com sucesso!' });
    } catch (error) {
        console.error('Erro ao salvar a reserva ou enviar o email:', error);
        return res.status(500).json({ success: false, message: 'Erro ao realizar a reserva' });
    }
});

// Rota para obter o histórico de reservas com filtros
app.get('/admin/reservas/historico', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    // Capturar os filtros de status, data de início e data de fim dos parâmetros de consulta
    const { status, dataInicio, dataFim } = req.query;
    const query = {};

    // Adicionar condições de filtro conforme os parâmetros recebidos
    if (status) {
        query.status = status; // Filtrar por status se fornecido
    }
    if (dataInicio) {
        query.dataInicio = { $gte: new Date(dataInicio) }; // Reservas com data de início maior ou igual a dataInicio
    }
    if (dataFim) {
        query.dataFim = query.dataFim || {};
        query.dataFim.$lte = new Date(dataFim); // Reservas com data de fim menor ou igual a dataFim
    }

    try {
        // Contar o total de reservas que atendem aos critérios de filtro
        const totalReservas = await Reserva.countDocuments(query);
        const reservas = await Reserva.find(query)
            .skip(skip)
            .limit(limit)
            .sort({ dataInicio: -1 }); // Ordenar pela data de início em ordem decrescente

        res.json({ totalReservas, reservas });
    } catch (err) {
        console.error('Erro ao buscar histórico de reservas:', err);
        res.status(500).json({ success: false, message: 'Erro ao carregar histórico de reservas.' });
    }
});

// Rota para obter as reservas
app.get('/admin/reservas', async (req, res) => {
    try {
        const reservas = await Reserva.find(); // Buscar todas as reservas
        res.json(reservas); // Retornar as reservas como JSON
    } catch (error) {
        console.error('Erro ao buscar reservas:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar reservas.' });
    }
});

// Rota para a interface do administrador
app.get('/admin', async (req, res) => {
    try {
        const reservas = await Reserva.find(); // Buscar todas as reservas
        res.render('admin', { reservas });
    } catch (error) {
        console.error('Erro ao buscar reservas:', error);
        res.render('admin', { reservas: [] });
    }
});

// Rota para confirmar a reserva
app.post('/admin/reservas/confirmar/:id', async (req, res) => {
    const reservaId = req.params.id;

    try {
        // Verifique se o ID é um ObjectId válido
        if (!mongoose.Types.ObjectId.isValid(reservaId)) {
            return res.status(400).json({ success: false, message: 'ID de reserva inválido.' });
        }

        const reserva = await Reserva.findById(reservaId);

        if (!reserva) {
            return res.status(404).json({ success: false, message: 'Reserva não encontrada.' });
        }

        if (reserva.status === 'rejeitada') {
            return res.status(400).json({ success: false, message: 'A reserva já foi rejeitada.' });
        }

        if (reserva.status === 'pendente') {
            const reservaconfirmada = await Reserva.findByIdAndUpdate(reservaId, { status: 'confirmada' }, { new: true });

            // Formatação amigável para as datas e horas
            const dataInicioFormatada = new Date(reservaconfirmada.dataInicio).toLocaleDateString('pt-BR', { dateStyle: 'short' });
            const horaInicioFormatada = new Date(reservaconfirmada.dataInicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            const dataFimFormatada = new Date(reservaconfirmada.dataFim).toLocaleDateString('pt-BR', { dateStyle: 'short' });
            const horaFimFormatada = new Date(reservaconfirmada.dataFim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            // Configurações do e-mail
            const mailOptions = {
                from: 'nao-responda@dokapack.com.br',
                to: reserva.email, // Email do solicitante
                subject: 'Reserva confirmada',
                text: `Olá ${reservaconfirmada.nome},\n\nSua solicitação de reserva foi confirmada!\n\nDetalhes da Reserva:\nData de Início: ${dataInicioFormatada} ${horaInicioFormatada}\nData de Término: ${dataFimFormatada} ${horaFimFormatada}\n\nObrigado!`
            };

            await enviarEmail(mailOptions);
            return res.status(200).json({ success: true, reserva: reservaconfirmada });
        } else {
            return res.status(400).json({ success: false, message: 'Reserva já foi confirmada.' });
        }
    } catch (error) {
        console.error('Erro ao confirmar a reserva:', error);
        return res.status(500).json({ success: false, message: 'Erro no servidor.' });
    }
});

// Rota para rejeitar a reserva
app.post('/admin/reservas/rejeitar/:id', async (req, res) => {
    const reservaId = req.params.id;

    try {
        // Verifique se o ID é um ObjectId válido
        if (!mongoose.Types.ObjectId.isValid(reservaId)) {
            return res.status(400).json({ success: false, message: 'ID de reserva inválido.' });
        }

        const reserva = await Reserva.findById(reservaId);

        if (!reserva) {
            return res.status(404).json({ success: false, message: 'Reserva não encontrada.' });
        }

        if (reserva.status === 'confirmada') {
            return res.status(400).json({ success: false, message: 'A reserva já foi confirmada e não pode ser rejeitada.' });
        }

        const reservarejeitada = await Reserva.findByIdAndUpdate(reservaId, { status: 'rejeitada' }, { new: true });

        const dataInicioFormatada = new Date(reservarejeitada.dataInicio).toLocaleDateString('pt-BR', { dateStyle: 'short' });
        const horaInicioFormatada = new Date(reservarejeitada.horaInicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        const dataFimFormatada = new Date(reservarejeitada.dataFim).toLocaleDateString('pt-BR', { dateStyle: 'short' });
        const horaFimFormatada = new Date(reservarejeitada.horaFim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        const mailOptions = {
            from: 'nao-responda@dokapack.com.br',
            to: reserva.email, // Email do solicitante
            subject: 'Reserva rejeitada',
            text: `Olá ${reservarejeitada.nome},\n\nLamentamos informar que sua solicitação de reserva foi rejeitada.\n\nDetalhes da Reserva:\nData de Início: ${dataInicioFormatada} ${horaInicioFormatada}\nData de Término: ${dataFimFormatada} ${horaFimFormatada}\n\nEntre em contato conosco para mais detalhes.`
        };        

        await enviarEmail(mailOptions);

        console.log('Reserva rejeitada:', reservarejeitada);

        return res.status(200).json({ success: true, reserva: reservarejeitada });
    } catch (error) {
        console.error('Erro ao rejeitar a reserva:', error);
        return res.status(500).json({ success: false, message: 'Erro no servidor.' });
    }
});

// Rota para obter horários indisponíveis
app.get('/reservas/horarios-indisponiveis', async (req, res) => {
    const { data } = req.query; // Data enviada no parâmetro de consulta

    if (!data) {
        return res.status(400).json({ success: false, message: 'Data não fornecida.' });
    }

    try {
        const reservas = await Reserva.find({
            dataInicio: { $lt: new Date(data + 'T23:59:59') },
            dataFim: { $gt: new Date(data + 'T00:00:00') },
            status: 'confirmada'
        });

        const horariosIndisponiveis = reservas.map(reserva => ({
            id: reserva._id,
            horaInicio: reserva.horaInicio,
            horaFim: reserva.horaFim,
            nome: reserva.nome
        }));

        console.log('Horários indisponíveis encontrados:', horariosIndisponiveis);
        return res.status(200).json({ success: true, horariosIndisponiveis });
    } catch (error) {
        console.error('Erro ao buscar horários indisponíveis:', error);
        return res.status(500).json({ success: false, message: 'Erro ao buscar horários indisponíveis.' });
    }
});

// Iniciar o servidor
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

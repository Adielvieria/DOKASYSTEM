const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const Reserva = require('./models/Reserva'); // Importando o modelo de Reserva

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para permitir o envio de dados de formulário

const mongoURI = process.env.MONGODB_URI;
const port = process.env.PORT || 3000;

mongoose.connect(mongoURI)
  .then(() => console.log('Conectado ao MongoDB'))
  .catch((err) => console.error('Erro ao conectar ao MongoDB:', err));

// Rota para criar uma nova reserva
app.post('/reservar', async (req, res) => {
    const { nome, email, dataInicio, dataFim } = req.body;

    // Verifica se o horário está disponível
    const conflito = await Reserva.findOne({
        $or: [
            { dataInicio: { $lt: new Date(dataFim) }, dataFim: { $gt: new Date(dataInicio) } }
        ]
    });

    if (conflito) {
        return res.status(400).json({ mensagem: "Esse horário já está reservado!" });
    }

    // Cria a nova reserva
    const novaReserva = new Reserva({ nome, email, dataInicio, dataFim });
    await novaReserva.save();
    
    res.status(201).json({ mensagem: "Reserva realizada com sucesso!" });
});

// Definindo uma rota básica para teste
app.get('/api/users', (req, res) => {
    res.status(200).json({ message: 'Usuários retornados com sucesso' });
});

app.listen(port, () => {
    console.log('Servidor rodando na porta ${port}');
});
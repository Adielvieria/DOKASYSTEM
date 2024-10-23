const mongoose = require('mongoose');

const reservaSchema = new mongoose.Schema({
    nome: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        match: /.+\@.+\..+/ // Regex simples para validação de email
    },
    dataInicio: {
        type: Date,
        required: true
    },
    dataFim: {
        type: Date,
        required: true,
        validate: {
            validator: function(value) {
                return value >= this.dataInicio;
            },
            message: 'A data de fim deve ser maior ou igual à data de início.'
        }
    },
    horaInicio: {
        type: String,
        required: true,
        match: /^([01]\d|2[0-3]):([0-5]\d)$/ // Valida formato HH:MM
    },
    horaFim: {
        type: String,
        required: true,
        match: /^([01]\d|2[0-3]):([0-5]\d)$/, // Valida formato HH:MM
        validate: {
            validator: function(value) {
                // Verifica se horaFim é maior que horaInicio
                return this.horaInicio < value;
            },
            message: 'A hora de término deve ser maior que a hora de início.'
        }
    },
    status: {
        type: String,
        enum: ['pendente', 'confirmada', 'rejeitada'],
        default: 'pendente'
    }
});

// Índices para otimização de consultas
reservaSchema.index({ dataInicio: 1 });
reservaSchema.index({ dataFim: 1 });
reservaSchema.index({ status: 1 });

// Exporta o modelo Reserva
module.exports = mongoose.model('Reserva', reservaSchema);

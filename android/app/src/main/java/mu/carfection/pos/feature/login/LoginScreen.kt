package mu.carfection.pos.feature.login

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import mu.carfection.pos.core.data.CatalogRepository
import mu.carfection.pos.core.data.SessionRepository
import mu.carfection.pos.ui.theme.Accent
import mu.carfection.pos.ui.theme.CardBg
import mu.carfection.pos.ui.theme.Condensed
import mu.carfection.pos.ui.theme.Hairline
import mu.carfection.pos.ui.theme.ScreenBg
import mu.carfection.pos.ui.theme.TextSecondary
import javax.inject.Inject

data class LoginUiState(val busy: Boolean = false, val error: String? = null)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val session: SessionRepository,
    private val catalog: CatalogRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state = _state.asStateFlow()

    fun signIn(email: String, password: String) {
        if (_state.value.busy) return
        _state.value = LoginUiState(busy = true)
        viewModelScope.launch {
            try {
                session.signIn(email, password)
                catalog.refresh() // warm the offline cache immediately
                _state.value = LoginUiState()
            } catch (e: Exception) {
                android.util.Log.e("POSREFRESH", "signIn/refresh failed", e)
                _state.value = LoginUiState(error = e.message ?: "Sign-in failed")
            }
        }
    }
}

@Composable
fun LoginScreen(viewModel: LoginViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Box(Modifier.fillMaxSize().background(ScreenBg), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .width(440.dp)
                .background(CardBg, RoundedCornerShape(20.dp))
                .border(1.dp, Hairline, RoundedCornerShape(20.dp))
                .padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("CARFECTIONIST", color = Accent, fontFamily = Condensed, fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            Text("Point of sale — sign in", color = TextSecondary, fontSize = 13.sp)
            Spacer(Modifier.height(2.dp))
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
            Button(
                onClick = { viewModel.signIn(email, password) },
                enabled = !state.busy && email.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (state.busy) CircularProgressIndicator(Modifier.height(22.dp).width(22.dp), strokeWidth = 2.dp)
                else Text("Sign in", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

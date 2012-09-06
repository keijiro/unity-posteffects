Shader "Post FX/VignettingShader" {
	Properties {
		_MainTex ("Base", 2D) = "" {}
	}

	Subshader {
		Pass {
			Cull Off
			ZTest Always
			ZWrite Off
			Fog { Mode off }

			GLSLPROGRAM

			uniform sampler2D _MainTex;

			uniform sampler2D vignetteTex;
			uniform lowp float intensity;
			uniform lowp float blur;
			varying lowp vec2 uv;

			#ifdef VERTEX
			void main() {
	            gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;
				uv = gl_MultiTexCoord0.xy;
			}
			#endif

			#ifdef FRAGMENT
			void main() {
				lowp vec4 color = texture2D(_MainTex, uv);
				lowp vec4 colorBlur = texture2D(vignetteTex, uv);

				vec2 coord = (uv - 0.5) * 2.0;
				lowp float coord2 = dot(coord, coord);

				lowp float mask = 1.0 - coord2 * intensity * 0.1;
				gl_FragColor = mix(color, colorBlur, min(blur * coord2, 1.0)) * mask;
			}
			#endif

			ENDGLSL
		}
	}
}
